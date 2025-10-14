import { getUserAccounts } from '@/actions/dashboard'
import { defaultCategories } from '@/data/categories'
import React from 'react'
import AddTransactionForm from '../_components/transaction-form'
import { getTransaction } from '@/actions/transaction'

const AddTransactionPage = async ({searchParams}) => {
  const accounts = await getUserAccounts()


const editId = searchParams?.edit;

let initialData = null;
if(editId) {
  const transaction = await getTransaction(editId);
  initialData = transaction;
}

  return (
    <div className="px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-5xl sm:text-5xl gradient-title mb-8 text-center">
        {editId ? "Edit" : "Add"} Transaction
        </h1>

        <AddTransactionForm
          accounts={accounts}
          categories={defaultCategories}
          editMode={!!editId}
          initialData={initialData}
        />
      </div>
    </div>
  )
}

export default AddTransactionPage;
