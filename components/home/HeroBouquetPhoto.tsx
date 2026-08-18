import Image from "next/image";

/**
 * Статичное фото букета справа от текста — вырезанное (прозрачный фон),
 * без анимации (сознательно, в отличие от парящих цветов в HeroBackdrop).
 * Рендерится только когда файл реально существует — проверка на сервере,
 * в Hero.tsx. См. README.md за требованиями к файлу.
 */
export function HeroBouquetPhoto({ src }: { src: string }) {
  return (
    <div className="relative mx-auto aspect-[4/3] w-full max-w-sm sm:max-w-md lg:aspect-square lg:max-w-none">
      <div
        className="absolute inset-6 rounded-full bg-lavender-200/60 blur-3xl sm:inset-10"
        aria-hidden="true"
      />
      <Image
        src={src}
        alt="Летний букет Floria"
        fill
        priority
        sizes="(min-width: 1024px) 560px, (min-width: 640px) 420px, 90vw"
        className="relative object-contain drop-shadow-xl"
      />
    </div>
  );
}
