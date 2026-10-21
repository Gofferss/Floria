"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OWNER_NAV, WORK_NAV, type NavItem } from "@/components/uchet/nav";
import { ToastProvider } from "@/components/uchet/Toast";

type Props = {
  staffName: string;
  isOwner: boolean;
  isTraining: boolean;
  children: React.ReactNode;
};

const ROLE_HINT = "Владелец видит себестоимость и разделы управления";

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Часы по Симферополю: планшет может стоять с чужим часовым поясом. */
function useClock(): string {
  const [now, setNow] = useState("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Simferopol",
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function RailItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const body = (
    <>
      <Icon className="h-6 w-6" />
      <span className="mt-1 text-[11px] font-medium leading-tight">{item.label}</span>
      {!item.ready && <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/35">скоро</span>}
    </>
  );

  const base = "relative flex w-full flex-col items-center rounded-xl px-1 py-2.5 text-center transition";

  if (!item.ready) {
    return (
      <span className={`${base} cursor-default text-white/30`} aria-disabled="true" title="Раздел в разработке">
        {body}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`${base} ${active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
    >
      {active && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-gold-400" aria-hidden="true" />}
      {body}
    </Link>
  );
}

/**
 * Каркас приложения учёта. Левый рельс всегда виден — раздел меняется
 * одним касанием, а не через «гамбургер». Верхняя строка держит то, что
 * флорист должен видеть всегда: режим учёта, связь, время, кто работает.
 */
export function AppShell({ staffName, isOwner, isTraining, children }: Props) {
  const pathname = usePathname();
  const online = useOnline();
  const clock = useClock();

  const items = isOwner ? [...WORK_NAV, ...OWNER_NAV] : WORK_NAV;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = items.find((i) => isActive(i.href));

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-100 font-body text-zinc-900">
      {/* Рельс — на планшете и компьютере. */}
      <nav aria-label="Разделы" className="hidden w-[84px] shrink-0 flex-col bg-plum-950 py-3 md:flex">
        <Link href="/uchet" className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gold-400 font-display text-sm font-bold text-plum-950" title="Флория Учёт">
          Ф
        </Link>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {WORK_NAV.map((item) => (
            <RailItem key={item.href} item={item} active={isActive(item.href)} />
          ))}
          {isOwner && (
            <>
              <div className="mx-3 my-2 h-px bg-white/10" aria-hidden="true" />
              {OWNER_NAV.map((item) => (
                <RailItem key={item.href} item={item} active={isActive(item.href)} />
              ))}
            </>
          )}
        </div>
        <Link href="/" className="mx-2 mt-2 rounded-xl px-1 py-2 text-center text-[11px] text-white/45 transition hover:bg-white/5 hover:text-white/80">
          На сайт ↗
        </Link>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate font-display text-base font-semibold text-zinc-900">
              {current?.label ?? "Флория Учёт"}
            </span>
            {isTraining && (
              <span
                className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800"
                title="Учёт ещё не запущен: документы попадают в отдельное место «Тренировка» и не смешиваются с настоящим учётом"
              >
                Тренировка
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-zinc-500" title={online ? "Связь есть" : "Нет связи с сервером"}>
              <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden="true" />
              <span className="hidden sm:inline">{online ? "на связи" : "нет связи"}</span>
            </span>
            <span className="tabular-nums text-zinc-500">{clock}</span>
            <span className="hidden max-w-[12rem] truncate font-medium text-zinc-800 sm:inline" title={isOwner ? ROLE_HINT : undefined}>
              {staffName}
              {isOwner && <span className="ml-1.5 text-xs font-normal text-zinc-400">владелец</span>}
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>

      {/* Телефон: те же разделы нижней полосой. */}
      <nav
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto bg-plum-950 px-2 pt-1.5 md:hidden"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {items.map((item) => (
          <div key={item.href} className="w-[72px] shrink-0">
            <RailItem item={item} active={isActive(item.href)} />
          </div>
        ))}
      </nav>
    </div>
  );
}
