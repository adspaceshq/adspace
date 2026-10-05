'use client'

import AdminDashboardView from '@/components/AdminDashboardView'
import { useAuthSession } from '@/components/AuthSessionProvider'
import Header from '@/components/Header'
import { ArrowRight } from 'lucide-react'

export default function ReviewPage() {
  const auth = useAuthSession()

  return (
    <div className="flex min-h-screen flex-col overflow-y-auto bg-[#f4f4f4]">
      <Header />
      <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-12 pt-4 md:pt-6">
        {!auth.ready ? (
          <div className="mx-auto max-w-3xl py-16" aria-label="Loading reviewer dashboard">
            <div className="animate-pulse space-y-5">
              <div className="h-8 w-56 rounded-xl bg-[#eeede8]" />
              <div className="h-4 w-full max-w-lg rounded-lg bg-[#f4f3ef]" />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="h-20 rounded-2xl bg-[#f4f3ef]" />
                <div className="h-20 rounded-2xl bg-[#f4f3ef]" />
                <div className="h-20 rounded-2xl bg-[#f4f3ef]" />
              </div>
            </div>
          </div>
        ) : !auth.authenticated ? (
          <section className="mx-auto max-w-lg py-16 text-center">
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-full bg-[#020817] font-mono text-lg font-medium text-white shadow-sm">
              X
            </div>
            <h1 className="text-2xl font-medium tracking-tight text-[#020817] sm:text-3xl">
              Platform Review
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[#64748b]">
              Log in with an authorized reviewer account to inspect space submissions, set on-chain commercial policies, and resolve disputes.
            </p>
            <button
              type="button"
              onClick={() => auth.login({ method: 'twitter' })}
              className="mt-7 inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#020817] px-7 py-3 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#1a2436] active:scale-[0.98]"
            >
              <span>Authenticate with X</span>
              <ArrowRight size={15} />
            </button>
          </section>
        ) : (
          <AdminDashboardView />
        )}
      </main>
    </div>
  )
}

