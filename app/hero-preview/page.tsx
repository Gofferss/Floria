import type { Metadata } from "next";
import { AmbientBlobs } from "@/components/home/AmbientBlobs";
import { StoriesRail } from "@/components/home/StoriesRail";
import { Hero } from "@/components/home/Hero";
import { HeroShowcase } from "@/components/home/hero-variants/HeroShowcase";
import { HeroLookbook } from "@/components/home/hero-variants/HeroLookbook";
import { HeroOccasions } from "@/components/home/hero-variants/HeroOccasions";

// ================================================================
// Страница выбора главного блока — только для владельца.
//
// Варианты показываем в настоящем сайте, а не картинками: здесь те же
// шрифты, та же палитра, те же живые фотографии из каталога и то же
// поведение на телефоне. По макету в картинке такое не выбрать — на
// картинке всё красиво.
//
// Из поиска закрыта явным noindex. Ссылок на неё ниоткуда нет, но
// полагаться на это нельзя: адрес попадёт в историю браузера, в чат,
// в закладки — и однажды в индекс.
// ================================================================

export const metadata: Metadata = {
  title: "Варианты главного блока — Floria",
  robots: { index: false, follow: false, nocache: true },
};

/** Дата сборки страницы не кэшируется: фото берутся из каталога «как сейчас». */
export const dynamic = "force-dynamic";

type VariantProps = {
  letter: string;
  title: string;
  note: string;
  children: React.ReactNode;
};

function Variant({ letter, title, note, children }: VariantProps) {
  return (
    <section className="border-t-4 border-dashed border-lavender-300 pt-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-2xl font-bold text-lavender-700">{letter}</span>
          <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
        </div>
        <p className="mt-1 max-w-2xl font-body text-sm leading-relaxed text-ink/60">{note}</p>
      </div>

      <div className="home-canvas relative mt-4 overflow-hidden">
        <AmbientBlobs />
        {children}
        <div className="relative z-20 mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8 lg:pb-14">
          <StoriesRail />
        </div>
      </div>
    </section>
  );
}

export default function HeroPreviewPage() {
  return (
    <div className="pb-20">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-bold text-ink">Варианты главного блока</h1>
        <p className="mt-3 max-w-2xl font-body text-base leading-relaxed text-ink/70">
          Листайте вниз: сначала то, что на сайте сейчас, затем три замены.
          Истории оставлены в каждом варианте. Фотографии — живые, из каталога,
          поэтому меняются вместе с ним. Скажите букву — поставлю на главную.
        </p>
        <p className="mt-3 font-body text-sm text-ink/50">
          Страница закрыта от поисковиков и ни с чем не связана — её видно
          только по этой ссылке.
        </p>
      </div>

      <div className="space-y-14">
        <Variant
          letter="0"
          title="Как сейчас"
          note="Вырезанный букет на сиреневом градиенте и три строки подряд об одном: «цветочная студия в Симферополе», «Студия цветов», «искусство в каждом букете»."
        >
          <Hero />
        </Variant>

        <Variant
          letter="А"
          title="Витрина"
          note="Одна большая фотография в кадре, без вырезания по контуру. Слева — одно обещание вместо трёх и три коротких довода. Самый спокойный и самый «студийный» из вариантов."
        >
          <HeroShowcase />
        </Variant>

        <Variant
          letter="Б"
          title="Лукбук"
          note="Три работы вразнобой. Показывает не один букет, а почерк студии — что собирают в одном стиле и что их много. Фотографии кликабельные."
        >
          <HeroLookbook />
        </Variant>

        <Variant
          letter="В"
          title="С чем пришли"
          note="Самый деловой. Сразу спрашивает про повод и уводит в отфильтрованный каталог. Меньше красоты, больше заказов — обычно так."
        >
          <HeroOccasions />
        </Variant>
      </div>
    </div>
  );
}
