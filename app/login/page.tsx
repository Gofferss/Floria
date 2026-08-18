import type { Metadata } from "next";
import { Suspense } from "react";
import { PhoneLoginForm } from "@/components/auth/PhoneLoginForm";
import { StaffLoginToggle } from "@/components/auth/StaffLoginToggle";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";

export const metadata: Metadata = {
  title: "Вход — Floria",
  description: "Вход в личный кабинет студии цветов Floria по коду из СМС.",
};

export default function LoginPage() {
  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-lavender-100 via-lavender-50 to-white">
      <BotanicalPattern className="pointer-events-none absolute inset-0 h-full w-full text-lavender-500/40" />

      <div className="relative mx-auto flex min-h-[75vh] max-w-md flex-col justify-center px-4 py-20 sm:px-6 sm:py-24">
        <div className="mb-8 text-center">
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Floria
          </span>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Личный кабинет
          </h1>
          <p className="mt-3 font-body text-sm leading-relaxed text-ink/60">
            Вход по коду из СМС — без паролей
          </p>
        </div>

        <div className="rounded-3xl border border-lavender-100 bg-white p-7 shadow-[0_24px_60px_-20px_rgba(94,74,150,0.28)] sm:p-9">
          {/* useSearchParams требует Suspense-границу в App Router */}
          <Suspense fallback={null}>
            <PhoneLoginForm />
          </Suspense>
        </div>

        <Suspense fallback={null}>
          <StaffLoginToggle />
        </Suspense>
      </div>
    </div>
  );
}
