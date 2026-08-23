"use client";

import { useState } from "react";

type Props = {
  src: string;
  title: string;
};

/**
 * Карта Яндекса грузится только после явного нажатия.
 *
 * Пока iframe не вставлен, к серверам Яндекса не уходит ни одного запроса — значит,
 * он не может поставить свои cookie посетителю, который на это не соглашался. Это
 * единственный сторонний встроенный элемент на сайте, поэтому такой заглушки
 * достаточно, чтобы обойтись без баннера о cookie на всех страницах.
 */
export function YandexMapEmbed({ src, title }: Props) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allowFullScreen
        className="h-[320px] w-full border-0 sm:h-[400px]"
      />
    );
  }

  return (
    <div className="flex h-[320px] w-full flex-col items-center justify-center gap-4 px-6 text-center sm:h-[400px]">
      <p className="max-w-sm font-body text-sm leading-relaxed text-ink/60">
        Здесь интерактивная карта Яндекса. Она загружается по нажатию, чтобы сторонний
        сервис не сохранял свои файлы cookie без вашего согласия.
      </p>
      <button
        type="button"
        onClick={() => setLoaded(true)}
        className="rounded-full bg-gold-500 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-gold-600"
      >
        Показать карту
      </button>
      <a
        href="/cookies"
        className="font-body text-xs text-ink/45 underline underline-offset-2 transition hover:text-gold-600"
      >
        Подробнее о файлах cookie
      </a>
    </div>
  );
}
