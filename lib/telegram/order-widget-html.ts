// ================================================================
// Живая карточка заказа в Telegram (виджет бота, Bot API 10.4).
//
// Карточка — HTML, который Telegram показывает в переписке с ботом и
// перерисовывает сам, когда бот меняет её данные (editMessageWidgetData):
// флорист двигает заказ в учёте — у клиента меняется этап, без нового
// сообщения. Внутри нет сети и нет Intl (движок QuickJS), поэтому даты и
// суммы приходят готовыми строками, а карточка их только раскладывает.
//
// Ограничения Telegram: HTML до 32 КБ и до 4 КБ после zlib -9 (проверка —
// scripts/check-widget-size.mjs), данные — до 1024 байт. Цвета — из темы
// Telegram (--tg-theme-*), запасные — фирменные, для просмотра вне Telegram.
// Текст из данных вставляется только через textContent: адрес и состав
// вводил покупатель.
//
// Данные (chat_data), JSON:
//   n  — номер заказа          s — этап: new|confirmed|assembling|ready|delivering|completed|cancelled
//   p  — 1, если самовывоз     w — «14 ноября, 10:00–13:00»
//   a  — адрес (для доставки)  i — строки состава, «Букет … × 1»
//   t  — «2 350 ₽»             pd — 1, если оплачен
// ================================================================

export const ORDER_WIDGET_HTML = `<style>
:root{--bg:var(--tg-theme-bg-color,#fff);--tx:var(--tg-theme-text-color,#1c1a22);--hi:var(--tg-theme-hint-color,#8a8494);--ac:var(--tg-theme-button-color,#7b5fb0);--at:var(--tg-theme-button-text-color,#fff);--sb:var(--tg-theme-secondary-bg-color,#f4f1fa);--er:var(--tg-theme-destructive-text-color,#c0392b)}
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.35 -apple-system,system-ui,sans-serif;color:var(--tx);padding:14px}
.no{font-size:12px;color:var(--hi);letter-spacing:.02em}
h1{font-size:18px;font-weight:700;margin-top:3px}
.sub{font-size:13px;color:var(--hi);margin-top:2px}
.bar{display:flex;gap:4px;margin-top:12px}
.bar i{flex:1;height:5px;border-radius:3px;background:var(--sb)}
.bar i.on{background:var(--ac)}
.box{background:var(--sb);border-radius:12px;padding:10px 12px;margin-top:12px;display:grid;gap:5px}
.r{display:flex;justify-content:space-between;gap:10px}
.r b{font-weight:400;color:var(--hi);flex:none}
.r span{text-align:right}
.it{font-size:13px}
.sum span{font-weight:700}
.pay{font-size:12px;color:var(--hi);text-align:right}
.btn{display:flex;gap:8px;margin-top:12px}
.btn div{flex:1;text-align:center;padding:9px 4px;border-radius:10px;font-weight:600;font-size:13px;background:var(--ac);color:var(--at)}
.btn div+div{background:var(--sb);color:var(--ac)}
.x h1{color:var(--er)}
</style>
<div id="w"></div>
<script>
var W=window.TelegramWidget,root=document.getElementById("w");
var ORDER=["new","confirmed","assembling","ready","delivering","completed"];
var TXT={
new:["Заказ принят","Скоро свяжемся и подтвердим детали"],
confirmed:["Заказ подтверждён","Флорист возьмётся за него к сроку"],
assembling:["Собираем букет","Пришлём фото, когда будет готов"],
ready:["Букет готов","Скоро передадим курьеру","Букет готов — ждём вас","Киевская улица, 5/2"],
delivering:["Курьер в пути","Позвонит получателю перед вручением"],
completed:["Доставлен","Спасибо, что выбрали Флорию!","Получен","Спасибо, что выбрали Флорию!"],
cancelled:["Заказ отменён","Если это ошибка — напишите нам"]};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function row(k,v,c){var r=el("div","r "+(c||""));r.appendChild(el("b",null,k));r.appendChild(el("span",null,v));return r}
function render(){
var d=null;try{d=JSON.parse(W?W.chatData:null)}catch(e){}
root.textContent="";
if(!d){root.appendChild(el("p","sub","Загружаем заказ…"));return}
var p=d.p==1,t=TXT[d.s]||TXT.new,pick=p&&t.length>2;
root.className=d.s=="cancelled"?"x":"";
root.appendChild(el("p","no","Заказ "+(d.n||"")));
root.appendChild(el("h1",null,pick?t[2]:t[0]));
root.appendChild(el("p","sub",pick?t[3]:t[1]));
if(d.s!="cancelled"){var b=el("div","bar"),k=ORDER.indexOf(d.s);for(var i=0;i<ORDER.length;i++)b.appendChild(el("i",i<=k?"on":""));root.appendChild(b)}
var x=el("div","box");
if(d.w)x.appendChild(row(p?"Забрать":"Когда",d.w));
x.appendChild(row(p?"Где":"Куда",p?"Киевская улица, 5/2":(d.a||"—")));
(d.i||[]).forEach(function(s){x.appendChild(el("div","it",s))});
if(d.t)x.appendChild(row("Итого",d.t,"sum"));
if(d.s!="cancelled")x.appendChild(el("div","pay",d.pd==1?"оплачен":"оплата при подтверждении"));
root.appendChild(x);
var bt=el("div","btn"),a=el("div",null,"Написать студии"),c=el("div",null,"Скопировать номер");
a.onclick=function(){W&&W.openTelegramLink("https://t.me/+79782401777")};
c.onclick=function(){W&&W.copyText("+7 978 240-17-77")};
bt.appendChild(a);bt.appendChild(c);root.appendChild(bt);
}
if(W){W.onEvent("chatDataChanged",render);W.onEvent("themeChanged",render)}
render();if(W)W.ready();
</script>`;
