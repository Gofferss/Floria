"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { Caveat } from "next/font/google";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { PhoneIcon, PinIcon } from "@/components/ui/Icons";
import { trackEvent } from "@/lib/analytics/track";
import { CONTACTS } from "@/lib/contacts";
import {
  CARD_OCCASIONS,
  CARD_TEXT_MAX,
  composeCardText,
  filmLine,
  formatFilmTime,
  type CardFilm,
} from "@/lib/card-message";

// ================================================================
// Открытка к букету — поле ввода в виде нашей же карточки.
//
// Человек пишет прямо на открытке: логотип сверху, телефоны и адрес снизу,
// как на настоящей. Так сразу видно, сколько текста на ней поместится и
// как он ляжет, — а не абстрактное «до 200 символов».
//
// Шрифт рукописный, а не машинописный: флорист пишет открытку от руки, и
// печатные буквы на экране пообещали бы то, чего в букете не будет.
// Подключён здесь, а не в общем макете, — нужен только на оформлении.
// ================================================================

const hand = Caveat({ subsets: ["latin", "cyrillic"], weight: ["400", "500"], display: "swap" });

/** Адрес так, как он напечатан на карточке студии. */
const CARD_ADDRESS = "ул. Киевская, 5";

/** Чернила шариковой ручки флориста — сине-фиолетовые, как на фото открыток. */
const INK = "text-[#2f3590]";

/** Скорость «письма» подсказки: быстро, чтобы не заставлять ждать. */
const WRITE_MS_PER_CHAR = 28;

type CardMessageFieldProps = {
  value: string;
  onChange: (value: string) => void;
  film: CardFilm;
  onFilmChange: (film: CardFilm) => void;
  /** Галочка «не указывать отправителя» — только для букета другому человеку. */
  showAnonymous: boolean;
  anonymous: boolean;
  onAnonymousChange: (value: boolean) => void;
  errors: { text?: string; film?: string; filmTime?: string };
};

export function CardMessageField({
  value,
  onChange,
  film,
  onFilmChange,
  showAnonymous,
  anonymous,
  onAnonymousChange,
  errors,
}: CardMessageFieldProps) {
  const [picked, setPicked] = useState<{ label: string; index: number } | null>(null);
  // Свой текст человека, который подсказка затёрла, — чтобы его можно было вернуть.
  const [ownText, setOwnText] = useState<string | null>(null);
  // Сколько букв подсказки уже «написано». В заказ фраза уходит сразу
  // целиком (onChange), а письмо — только показ: нажми человек «Перейти к
  // оплате» посреди анимации, в заказ не попадёт обрывок фразы.
  const [shownLen, setShownLen] = useState<number | null>(null);
  const writing = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // Поле растёт вместе с текстом, а не держит фиксированную высоту: тогда
  // строка с фильмом встаёт сразу под текстом, как её и напишет флорист,
  // а не висит внизу карточки после пустого места.
  // Пересчёт и при повороте телефона, и когда догрузится рукописный шрифт:
  // строки переносятся иначе, а лишнее поле обрезает (overflow-hidden).
  const fit = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value, shownLen]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => window.removeEventListener("resize", fit);
  }, []);

  const stopWriting = () => {
    if (writing.current !== null) window.clearInterval(writing.current);
    writing.current = null;
    setShownLen(null);
  };
  useEffect(() => () => {
    if (writing.current !== null) window.clearInterval(writing.current);
  }, []);

  function write(phrase: string) {
    stopWriting();
    onChange(phrase);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Буквы считаются по прошедшему времени, а не по числу срабатываний:
    // в фоновой вкладке браузер редко будит таймер, и письмо иначе
    // растянулось бы на минуту.
    const start = performance.now();
    setShownLen(0);
    writing.current = window.setInterval(() => {
      const shown = Math.floor((performance.now() - start) / WRITE_MS_PER_CHAR) + 1;
      if (shown >= phrase.length) stopWriting();
      else setShownLen(shown);
    }, WRITE_MS_PER_CHAR);
  }

  function pickOccasion(label: string, phrases: string[]) {
    const index = picked?.label === label ? (picked.index + 1) % phrases.length : 0;
    const isHint = CARD_OCCASIONS.some((o) => o.phrases.includes(value));
    if (value.trim() && !isHint) setOwnText(value);
    setPicked({ label, index });
    trackEvent("button_click", `Открытка: ${label}`);
    write(phrases[index]);
  }

  function restoreOwnText() {
    stopWriting();
    if (ownText !== null) onChange(ownText);
    setOwnText(null);
    setPicked(null);
  }

  const line = filmLine(film);
  const total = composeCardText(value, film).length;
  const over = total > CARD_TEXT_MAX;

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink">Открытка к букету</h2>
      <p className="mt-1 font-body text-sm text-ink/50">
        Бесплатно. Флорист перепишет текст от руки на нашу открытку и приложит к букету.
      </p>

      <p className="mt-4 font-body text-xs text-ink/50">Не знаете, что написать? Выберите повод:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {CARD_OCCASIONS.map((o) => {
          const active = picked?.label === o.label;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => pickOccasion(o.label, o.phrases)}
              className={`rounded-full border px-3.5 py-1.5 font-body text-sm transition ${
                active
                  ? "border-gold-500 bg-gold-500 text-white"
                  : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {picked && !ownText && (
        <p className="mt-2 font-body text-xs text-ink/45">Нажмите на повод ещё раз — будет другой вариант.</p>
      )}
      {ownText && (
        <button
          type="button"
          onClick={restoreOwnText}
          className="mt-2 font-body text-xs text-lavender-700 underline decoration-lavender-300 underline-offset-2"
        >
          Вернуть мой текст
        </button>
      )}

      {/* Сама открытка. Рамка подсвечивается, когда в ней курсор: поле
          не похоже на обычное, и без этого непонятно, что сюда пишут.
          Нажатие на пустую бумагу тоже ставит курсор в текст — открытка
          целиком и есть поле. */}
      <div
        onClick={(e) => {
          if (e.target !== area.current) area.current?.focus();
        }}
        className={`mx-auto mt-4 flex min-h-[25rem] w-full max-w-[400px] flex-col rounded-md bg-white px-6 pb-4 pt-5 shadow-[0_14px_34px_-18px_rgba(94,74,150,0.5)] ring-1 transition focus-within:ring-2 ${
          over || errors.text ? "ring-red-300" : "ring-black/5 focus-within:ring-gold-400"
        }`}
      >
        <div className="border-b border-ink/15 pb-3">
          <Image src="/logo.png" alt="Флория — студия цветов" width={1179} height={289} className="mx-auto h-auto w-[150px]" />
        </div>

        <label htmlFor="cardText" className="sr-only">
          Текст открытки
        </label>
        <textarea
          ref={area}
          id="cardText"
          value={shownLen === null ? value : value.slice(0, shownLen)}
          maxLength={Math.max(0, CARD_TEXT_MAX - (line ? line.length + 1 : 0))}
          onChange={(e) => {
            stopWriting();
            setOwnText(null);
            setPicked(null);
            onChange(e.target.value);
          }}
          rows={2}
          placeholder="Напишите пару тёплых слов или выберите повод выше"
          className={`${hand.className} ${INK} mt-3 w-full resize-none overflow-hidden bg-transparent text-[23px] leading-[1.3] outline-none placeholder:text-ink/30`}
        />
        {line && <p className={`${hand.className} ${INK} break-words text-[23px] leading-[1.3]`}>{line}</p>}
        {showAnonymous && anonymous && (
          <p className={`${hand.className} mt-1 text-right text-lg text-ink/40`}>без подписи</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-5 font-serif text-[11px] leading-snug text-ink/70">
          <div>
            <p className="flex items-center gap-1">
              <PhoneIcon className="h-3 w-3 shrink-0" />
              {CONTACTS.phone}
            </p>
            <p className="pl-4">{CONTACTS.phoneSecondary}</p>
          </div>
          <p className="flex items-center gap-1">
            <PinIcon className="h-3 w-3 shrink-0" />
            {CARD_ADDRESS}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-1.5 flex max-w-[400px] items-start justify-between gap-3 font-body text-xs">
        {over || errors.text ? (
          <p className="text-red-600">{errors.text ?? `Открытка вмещает ${CARD_TEXT_MAX} символов — сократите текст`}</p>
        ) : (
          <p className="text-ink/40">Почерк будет живой — это только пример.</p>
        )}
        <p className={`shrink-0 ${over ? "text-red-600" : "text-ink/40"}`}>
          {total}/{CARD_TEXT_MAX}
        </p>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-lavender-200 bg-white/60 p-4 transition hover:border-gold-400">
        <input
          type="checkbox"
          checked={film.on}
          onChange={(e) => {
            if (e.target.checked) trackEvent("button_click", "Открытка: момент из фильма");
            onFilmChange({ ...film, on: e.target.checked });
          }}
          className="mt-0.5 h-5 w-5 shrink-0 accent-gold-500"
        />
        <span>
          <span className="block font-body text-sm font-medium text-ink">Добавить момент из фильма</span>
          <span className="mt-0.5 block font-body text-xs text-ink/50">
            Напишем на открытке название и время сцены — получатель найдёт фильм и посмотрит именно этот момент.
          </span>
        </span>
      </label>
      {film.on && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <FormField label="Фильм" htmlFor="cardFilm" error={errors.film}>
            <input
              id="cardFilm"
              value={film.title}
              maxLength={80}
              onChange={(e) => onFilmChange({ ...film, title: e.target.value })}
              placeholder="Гордость и предубеждение"
              className={inputClass(!!errors.film)}
            />
          </FormField>
          <FormField label="Время сцены" htmlFor="cardFilmTime" error={errors.filmTime} hint="Часы:минуты:секунды">
            <input
              id="cardFilmTime"
              value={film.time}
              inputMode="numeric"
              onChange={(e) => onFilmChange({ ...film, time: formatFilmTime(e.target.value) })}
              placeholder="1:55:10"
              className={inputClass(!!errors.filmTime)}
            />
          </FormField>
        </div>
      )}

      {showAnonymous && (
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-lavender-200 bg-white/60 p-4 transition hover:border-gold-400">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => onAnonymousChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-gold-500"
          />
          <span>
            <span className="block font-body text-sm font-medium text-ink">Не указывать отправителя</span>
            <span className="mt-0.5 block font-body text-xs text-ink/50">
              Получатель не узнает, от кого букет: открытку не подпишем, курьер не назовёт ваше имя. Если в тексте
              открытки есть подпись — уберите её.
            </span>
          </span>
        </label>
      )}
    </section>
  );
}
