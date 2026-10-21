import { redirect } from "next/navigation";

/** Пока готов один раздел — открываем его. Когда появится касса, флорист будет попадать в неё. */
export default function UchetHome() {
  redirect("/uchet/sklad");
}
