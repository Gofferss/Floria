import type { ComponentType } from "react";
import {
  BanknoteIcon,
  BouquetIcon,
  CardIcon,
  ChartBarIcon,
  ClockIcon,
  EditIcon,
  PackageIcon,
  PinIcon,
  StarIcon,
  TagIcon,
  TruckIcon,
  UserIcon,
} from "@/components/ui/Icons";

// ================================================================
// Разделы приложения учёта.
//
// Две группы, как на рабочем месте: «Работа» — то, чем флорист пользуется
// весь день, «Управление» — то, что нужно владельцу. У Posiflora всё это в
// одном меню глубиной до трёх уровней («Учёт и финансы → Склад →
// Приходные накладные»); здесь уровень один, а виды документов — фильтром
// внутри раздела, а не отдельными пунктами меню.
//
// Разделы, которых ещё нет, видны в меню с пометкой «скоро» — чтобы было
// понятно, каким приложение станет, — но не открываются.
// ================================================================

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  ready: boolean;
  ownerOnly?: boolean;
};

export const WORK_NAV: NavItem[] = [
  { href: "/uchet/kassa", label: "Касса", icon: BanknoteIcon, ready: true },
  { href: "/uchet/zakazy", label: "Заказы", icon: TruckIcon, ready: true },
  { href: "/uchet/dostavki", label: "Доставки", icon: PinIcon, ready: true },
  { href: "/uchet/vitrina", label: "Витрина", icon: BouquetIcon, ready: true },
  { href: "/uchet/sklad", label: "Склад", icon: PackageIcon, ready: true },
  { href: "/uchet/smena", label: "Смена", icon: ClockIcon, ready: true },
];

export const OWNER_NAV: NavItem[] = [
  { href: "/uchet/svodka", label: "Сводка", icon: ChartBarIcon, ready: true, ownerOnly: true },
  { href: "/uchet/katalog", label: "Каталог", icon: TagIcon, ready: false, ownerOnly: true },
  { href: "/uchet/dengi", label: "Деньги", icon: CardIcon, ready: true, ownerOnly: true },
  { href: "/uchet/klienty", label: "Клиенты", icon: UserIcon, ready: true, ownerOnly: true },
  { href: "/uchet/lyudi", label: "Сотрудники", icon: StarIcon, ready: true, ownerOnly: true },
  { href: "/uchet/nastroiki", label: "Настройки", icon: EditIcon, ready: true, ownerOnly: true },
];

/** Курьеру — только его раздел: доставки, адреса, статусы. */
export const COURIER_NAV: NavItem[] = [{ href: "/uchet/dostavki", label: "Доставки", icon: PinIcon, ready: true }];
