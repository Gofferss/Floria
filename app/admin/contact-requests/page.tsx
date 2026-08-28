import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { listContactRequests } from "@/lib/actions/contact-requests";
import { MarkHandledButton } from "@/components/admin/contact/MarkHandledButton";

export const metadata: Metadata = {
  title: "Обращения — Админка Floria",
};

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AdminContactRequestsPage() {
  await requireStaffUser();
  const requests = await listContactRequests();

  const undelivered = requests.filter((r) => !r.staffNotifiedAt && !r.handledAt);
  const unhandled = requests.filter((r) => !r.handledAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Админка
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Обращения</h1>
        <p className="mt-2 font-body text-sm text-ink/60">
          Заявки на обратный звонок с сайта. Ждут ответа: {unhandled.length}.
        </p>
      </div>

      {undelivered.length > 0 && (
        // Про этот блок стоит знать: он появляется, когда уведомление в
        // Telegram не дошло. Раньше такие обращения просто пропадали —
        // теперь они лежат здесь, и это единственное место, где их видно.
        <div className="mb-8 rounded-3xl border border-red-200 bg-red-50 px-6 py-5">
          <p className="font-display text-sm font-semibold text-red-800">
            Не дошли в Telegram: {undelivered.length}
          </p>
          <p className="mt-1 font-body text-sm text-red-700">
            Эти обращения сохранены, но сообщение о них не отправилось. Мы продолжаем досылать
            автоматически — а пока свяжитесь с людьми отсюда.
          </p>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Обращений пока нет</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {requests.map((request) => (
            <li
              key={request.id}
              className={`rounded-3xl border bg-white p-6 ${
                request.handledAt ? "border-lavender-100 opacity-60" : "border-lavender-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-ink">{request.name}</p>
                  <a
                    href={`tel:${request.phone}`}
                    className="font-body text-sm text-gold-700 underline-offset-2 hover:underline"
                  >
                    {request.phone}
                  </a>
                  <p className="mt-1 font-body text-xs text-ink/50">
                    {dateFormatter.format(new Date(request.createdAt))}
                    {!request.staffNotifiedAt && " · не дошло в Telegram"}
                    {request.handledAt && " · связались"}
                  </p>
                </div>

                {!request.handledAt && <MarkHandledButton id={request.id} />}
              </div>

              {request.message && (
                <p className="mt-4 whitespace-pre-wrap font-body text-sm text-ink/80">
                  {request.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
