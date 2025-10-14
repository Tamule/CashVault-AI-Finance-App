import { inngest } from "./client";
import { db } from "@/lib/prisma";
import EmailTemplate from "@/emails/template";
import { sendEmail } from "@/actions/send-email";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1️⃣ Recurring Transaction Processing with Throttling
export const processRecurringTransaction = inngest.createFunction(
  {
    id: "process-recurring-transaction",
    name: "Process Recurring Transaction",
    throttle: {
      limit: 10,
      period: "1m",
      key: "event.data.userId",
    },
  },
  { event: "transaction.recurring.process" },
  async ({ event, step }) => {
    try {
      if (!event?.data?.transactionId || !event?.data?.userId) return;

      await step.run("process-transaction", async () => {
        const transaction = await db.transaction.findUnique({
          where: { id: event.data.transactionId, userId: event.data.userId },
          include: { account: true },
        });
        if (!transaction || !isTransactionDue(transaction)) return;

        await db.$transaction(async (tx) => {
          const amountValue = transaction.amount ? transaction.amount.toNumber() : 0;

          await tx.transaction.create({
            data: {
              type: transaction.type,
              amount: transaction.amount,
              description: `${transaction.description} (Recurring)`,
              date: new Date(),
              category: transaction.category,
              userId: transaction.userId,
              accountId: transaction.accountId,
              isRecurring: false,
            },
          });

          const balanceChange = transaction.type === "EXPENSE" ? -amountValue : amountValue;

          await tx.account.update({
            where: { id: transaction.accountId },
            data: { balance: { increment: balanceChange } },
          });

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              lastProcessed: new Date(),
              nextRecurringDate: calculateNextRecurringDate(
                new Date(),
                transaction.recurringInterval
              ),
            },
          });
        });
      });
    } catch (error) {
      console.error("Error in processRecurringTransaction:", error);
      throw error;
    }
  }
);

// 2️⃣ Trigger Recurring Transactions
export const triggerRecurringTransactions = inngest.createFunction(
  { id: "trigger-recurring-transactions", name: "Trigger Recurring Transactions" },
  { cron: "0 0 * * *" },
  async ({ step }) => {
    try {
      const recurringTransactions = await step.run("fetch-recurring-transactions", async () => {
        return await db.transaction.findMany({
          where: {
            isRecurring: true,
            status: "COMPLETED",
            OR: [
              { lastProcessed: null },
              { nextRecurringDate: { lte: new Date() } },
            ],
          },
        });
      });

      if (recurringTransactions.length > 0) {
        const events = recurringTransactions.map((t) => ({
          name: "transaction.recurring.process",
          data: { transactionId: t.id, userId: t.userId },
        }));
        await inngest.send(events);
      }

      return { triggered: recurringTransactions.length };
    } catch (error) {
      console.error("Error in triggerRecurringTransactions:", error);
      throw error;
    }
  }
);

// 3️⃣ Generate Monthly Reports
async function generateFinancialInsights(stats, month) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `
      Analyze this financial data and provide 3 concise, actionable insights.
      Financial Data for ${month}:
      - Total Income: $${stats.totalIncome}
      - Total Expenses: $${stats.totalExpenses}
      - Net Income: $${stats.totalIncome - stats.totalExpenses}
      - Expense Categories: ${Object.entries(stats.byCategory || {})
        .map(([c, a]) => `${c}: $${a}`)
        .join(", ")}
      Format as JSON array: ["insight 1","insight 2","insight 3"]
    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (error) {
    console.error("Error generating AI insights:", error);
    return [
      "Your highest expense category this month might need attention.",
      "Consider setting up a budget for better financial management.",
      "Track your recurring expenses to identify potential savings.",
    ];
  }
}

export const generateMonthlyReports = inngest.createFunction(
  { id: "generate-monthly-reports", name: "Generate Monthly Reports" },
  { cron: "0 0 1 * *" },
  async ({ step }) => {
    try {
      const users = await step.run("fetch-users", async () => {
        return await db.user.findMany({ include: { accounts: true } });
      });

      for (const user of users) {
        await step.run(`generate-report-${user.id}`, async () => {
          const lastMonth = new Date();
          lastMonth.setMonth(lastMonth.getMonth() - 1);

          const stats = await getMonthlyStats(user.id, lastMonth);
          const monthName = lastMonth.toLocaleString("default", { month: "long" });
          const insights = await generateFinancialInsights(stats, monthName);

          const defaultAccount = user.accounts.find((acc) => acc.isDefault);
          if (!defaultAccount || !user.email) return;

          await sendEmail({
            to: user.email,
            subject: `Your Monthly Financial Report - ${monthName}`,
            react: EmailTemplate({
              userName: user.name,
              type: "monthly-report",
              data: { stats, month: monthName, insights },
            }),
          });
        });
      }

      return { processed: users.length };
    } catch (error) {
      console.error("Error in generateMonthlyReports:", error);
      throw error;
    }
  }
);

// 4️⃣ Check Budget Alerts
export const checkBudgetAlerts = inngest.createFunction(
  { name: "Check Budget Alerts" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    try {
      const budgets = await step.run("fetch-budgets", async () => {
        return await db.budget.findMany({
          include: {
            user: { include: { accounts: { where: { isDefault: true } } } },
          },
        });
      });

      for (const budget of budgets) {
        const defaultAccount = budget.user.accounts[0];
        if (!defaultAccount || !budget.user.email) continue;

        await step.run(`check-budget-${budget.id}`, async () => {
          const startDate = new Date();
          startDate.setDate(1);

          const expenses = await db.transaction.aggregate({
            where: {
              userId: budget.userId,
              accountId: defaultAccount.id,
              type: "EXPENSE",
              date: { gte: startDate },
            },
            _sum: { amount: true },
          });

          const totalExpenses = expenses._sum.amount?.toNumber() || 0;
          const budgetAmount = budget.amount;
          const percentageUsed = (totalExpenses / budgetAmount) * 100;

          if (
            percentageUsed >= 80 &&
            (!budget.lastAlertSent || isNewMonth(new Date(budget.lastAlertSent), new Date()))
          ) {
            await sendEmail({
              to: budget.user.email,
              subject: `Budget Alert for ${defaultAccount.name}`,
              react: EmailTemplate({
                userName: budget.user.name,
                type: "budget-alert",
                data: {
                  percentageUsed: parseFloat(percentageUsed.toFixed(1)),
                  budgetAmount: parseFloat(budgetAmount.toFixed(1)),
                  totalExpenses: parseFloat(totalExpenses.toFixed(1)),
                  accountName: defaultAccount.name,
                },
              }),
            });

            await db.budget.update({
              where: { id: budget.id },
              data: { lastAlertSent: new Date() },
            });
          }
        });
      }
    } catch (error) {
      console.error("Error in checkBudgetAlerts:", error);
      throw error;
    }
  }
);

// Utility Functions
function isNewMonth(lastAlertDate, currentDate) {
  return lastAlertDate.getMonth() !== currentDate.getMonth() || lastAlertDate.getFullYear() !== currentDate.getFullYear();
}

function isTransactionDue(transaction) {
  if (!transaction.lastProcessed) return true;
  return new Date(transaction.nextRecurringDate) <= new Date();
}

function calculateNextRecurringDate(date, interval) {
  const next = new Date(date);
  switch (interval) {
    case "DAILY": next.setDate(next.getDate() + 1); break;
    case "WEEKLY": next.setDate(next.getDate() + 7); break;
    case "MONTHLY": next.setMonth(next.getMonth() + 1); break;
    case "YEARLY": next.setFullYear(next.getFullYear() + 1); break;
  }
  return next;
}

async function getMonthlyStats(userId, month) {
  const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
  const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  const transactions = await db.transaction.findMany({
    where: { userId, date: { gte: startDate, lte: endDate } },
  });

  return transactions.reduce(
    (stats, t) => {
      const amount = t.amount ? t.amount.toNumber() : 0;
      if (t.type === "EXPENSE") {
        stats.totalExpenses += amount;
        stats.byCategory[t.category] = (stats.byCategory[t.category] || 0) + amount;
      } else {
        stats.totalIncome += amount;
      }
      return stats;
    },
    { totalExpenses: 0, totalIncome: 0, byCategory: {}, transactionCount: transactions.length }
  );
}
