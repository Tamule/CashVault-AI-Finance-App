"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import useFetch from "@/hooks/use-fetch";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { createTransaction, updateTransaction } from "@/actions/transaction";
import { ReceiptScanner } from "./receipt-scanner";
import CreateAccountDrawer from "@/components/create-account-drawer";
import { transactionSchema } from "@/app/lib/schema";

export function AddTransactionForm({ accounts, categories, editMode = false, initialData = null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    getValues,
    reset,
  } = useForm({
    resolver: zodResolver(transactionSchema),
    defaultValues:
    editMode && initialData ? {
       type: initialData.type,
            amount: initialData.amount.toString(),
            description: initialData.description,
            accountId: initialData.accountId,
            category: initialData.category,
            date: new Date(initialData.date),
            isRecurring: initialData.isRecurring,
            ...(initialData.recurringInterval && {
              recurringInterval: initialData.recurringInterval,
            }),
    } :
    {
      type: "EXPENSE",
      amount: "",
      description: "",
      accountId: accounts.find((ac) => ac.isDefault)?.id || "",
      date: new Date(),
      isRecurring: false,
      category: "",
    },
  });

  const { loading: transactionLoading, 
    fn: transactionFn,
     data: transactionResult
     }  =
    useFetch(editMode ? updateTransaction : createTransaction);

  // -------------------------
  // Form submit handler
  // -------------------------
  const onSubmit = (data) => {
    const formData = {
      ...data,
      amount: parseFloat(data.amount),
      accountId: data.accountId || accounts.find((ac) => ac.isDefault)?.id,
    };

    if(editMode) {
      transactionFn(editId, formData);
    } else {
    transactionFn(formData);
    }
  };

  // -------------------------
  // Handle scanned receipt
  // -------------------------
  const handleScanComplete = async (scannedData) => {
    if (!scannedData) return;

    // Populate form fields
    setValue("amount", scannedData.amount?.toString() || "0");
    setValue("date", new Date(scannedData.date));
    setValue("description", scannedData.merchantName || scannedData.description || "");
    setValue("category", scannedData.category || "");
    
    toast.success("Receipt scanned successfully");

    // Auto-submit the scanned transaction
    const formData = {
      type: "EXPENSE",
      amount: scannedData.amount ?? 0,
      description: scannedData.merchantName || scannedData.description || "",
      accountId: getValues("accountId") || accounts.find((ac) => ac.isDefault)?.id,
      date: scannedData.date ? new Date(scannedData.date) : new Date(),
      isRecurring: false,
      category: scannedData.category ?? "",
    };

    await transactionFn(formData);
  };

  // -------------------------
  // Handle transaction result
  // -------------------------
  useEffect(() => {
    if (transactionResult?.success && !transactionLoading) {
      toast.success(
        editMode ? 
        "Transaction updated successfully"
       : "Transaction created successfully");
      reset();
      router.push(`/account/${transactionResult.data.accountId}`);
    }
  }, [transactionResult, transactionLoading, editMode]);

  const type = watch("type");
  const isRecurring = watch("isRecurring");
  const date = watch("date");

  const filteredCategories = categories.filter((c) => c.type === type);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Receipt Scanner */}
     {!editMode && <ReceiptScanner onScanComplete={handleScanComplete} /> }

      {/* Type */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Type</label>
        <Select
          onValueChange={(v) => setValue("type", v)}
          defaultValue={type}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="INCOME">Income</SelectItem>
          </SelectContent>
        </Select>
        {errors.type && <p className="text-sm text-red-500">{errors.type.message}</p>}
      </div>

      {/* Amount + Account */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Amount</label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            {...register("amount")}
          />
          {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Account</label>
          <Select
            onValueChange={(v) => setValue("accountId", v)}
            defaultValue={getValues("accountId")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((ac) => (
                <SelectItem key={ac.id} value={ac.id}>
                  {ac.name} (${parseFloat(ac.balance).toFixed(2)})
                </SelectItem>
              ))}
              <CreateAccountDrawer>
                <Button variant="ghost" className="w-full text-left">
                  Create Account
                </Button>
              </CreateAccountDrawer>
            </SelectContent>
          </Select>
          {errors.accountId && (
            <p className="text-sm text-red-500">{errors.accountId.message}</p>
          )}
        </div>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Category</label>
        <Select
          onValueChange={(v) => setValue("category", v)}
          defaultValue={getValues("category")}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.category && <p className="text-sm text-red-500">{errors.category.message}</p>}
      </div>

      {/* Date */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Date</label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !date && "text-muted-foreground")}>
              {date ? format(date, "PPP") : <span>Pick a date</span>}
              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => setValue("date", d)}
              disabled={(d) => d > new Date() || d < new Date("1900-01-01")}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Input placeholder="Enter description" {...register("description")} />
      </div>

      {/* Recurring */}
      <div className="flex justify-between items-center border rounded-lg p-4">
        <div>
          <label className="text-sm font-medium">Recurring Transaction</label>
          <p className="text-xs text-muted-foreground">Set up a recurring schedule</p>
        </div>
        <Switch
          checked={isRecurring}
          onCheckedChange={(checked) => setValue("isRecurring", checked)}
        />
      </div>

      {isRecurring && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Recurring Interval</label>
          <Select
            onValueChange={(v) => setValue("recurringInterval", v)}
            defaultValue={getValues("recurringInterval")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select interval" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
              <SelectItem value="MONTHLY">Monthly</SelectItem>
              <SelectItem value="YEARLY">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
        <Button type="button" variant="outline" className="w-[80%]" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" className="w-[80%] " disabled={transactionLoading}>
          {transactionLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {editMode ? "Updating..." : "Creating..."}
            </>
          ) : editMode ? (
            "Update Transaction"
          ) : (
            "Create Transaction"
          )}
        </Button>
      </div>
    </form>
  );
}

export default AddTransactionForm;
