// ================================================================
// Панель владельца в Telegram (виджет Bot API 10.4): «Сегодня / Заказы /
// Деньги». Данные карточка запрашивает у бота сама — при открытии
// (фоновый запрос, в личном чате можно) и по нажатию на вкладку
// (TelegramWidget.request → widget_query → answerWidgetQuery). Бот отвечает
// готовыми строками: внутри карточки нет сети и нет Intl.
//
// Ответы (JSON, до 1024 байт), поле t — вкладка, at — время «на сейчас»:
//   today:  k — плитки [подпись, число, 1 если тревожно], l — строки
//   orders: o — [когда, №, имя, этап, сумма, оплачен 0/1], m — сколько ещё
//   money:  r — [подпись, сумма, пояснение], th — {p: %, a, f} порог 20 млн
//   err — что не так (тогда показываем прежние данные и эту строку)
// Лимиты Telegram: HTML до 32 КБ / 4 КБ после zlib -9
// (scripts/check-widget-size.mjs). Текст из ответа — только textContent.
// ================================================================

export const OWNER_PANEL_HTML = `<style>
:root{--bg:var(--tg-theme-bg-color,#fff);--tx:var(--tg-theme-text-color,#1c1a22);--hi:var(--tg-theme-hint-color,#8a8494);--ac:var(--tg-theme-button-color,#7b5fb0);--sb:var(--tg-theme-secondary-bg-color,#f4f1fa);--er:var(--tg-theme-destructive-text-color,#c0392b)}
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.35 -apple-system,system-ui,sans-serif;color:var(--tx);padding:12px}
.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.hd b{font-size:16px}
.hd span{font-size:12px;color:var(--hi)}
.tb{display:flex;gap:3px;background:var(--sb);border-radius:10px;padding:3px;margin-top:10px}
.tb div{flex:1;text-align:center;padding:7px 2px;border-radius:8px;font-size:13px;font-weight:600;color:var(--hi)}
.tb div.on{background:var(--bg);color:var(--tx)}
.k{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
.k div{background:var(--sb);border-radius:10px;padding:8px 10px}
.k b{display:block;font-size:22px;line-height:1.15}
.k span{font-size:12px;color:var(--hi)}
.k .w b{color:var(--er)}
.l{margin-top:10px;display:grid;gap:5px;font-size:13px}
.o{background:var(--sb);border-radius:10px;padding:7px 10px}
.o .s{font-size:12px;color:var(--hi)}
.np{color:var(--er);font-weight:600}
.r{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:7px 0;border-bottom:1px solid var(--sb)}
.r b{font-size:16px}
.r span{font-size:12px;color:var(--hi);text-align:right}
.th{margin-top:10px;background:var(--sb);border-radius:10px;padding:8px 10px;font-size:13px}
.bar{height:6px;border-radius:3px;background:var(--bg);margin:6px 0;overflow:hidden}
.bar i{display:block;height:100%;background:var(--ac)}
.th .s{font-size:12px;color:var(--hi)}
.er{margin-top:8px;color:var(--er);font-size:13px}
.em{margin-top:10px;color:var(--hi);font-size:13px}
</style>
<div class="hd"><b>Флория</b><span id="at"></span></div>
<div class="tb" id="tb"></div>
<div id="c"></div>
<script>
var W=window.TelegramWidget,TABS=[["today","Сегодня"],["orders","Заказы"],["money","Деньги"]],cur="today",data={},busy=false,err="";
try{var x=JSON.parse(W?W.chatData:null);if(x&&x.t)data[x.t]=x}catch(e){}
var $=function(i){return document.getElementById(i)};
function el(t,c,s){var e=document.createElement(t);if(c)e.className=c;if(s!=null)e.textContent=s;return e}
function add(p,e){p.appendChild(e);return e}
function draw(){
var tb=$("tb");tb.textContent="";
TABS.forEach(function(t){var d=add(tb,el("div",t[0]==cur?"on":"",t[1]));d.onclick=function(){if(cur!=t[0]){cur=t[0];draw()}load()}});
var d=data[cur],c=$("c");c.textContent="";
$("at").textContent=busy?"обновляю…":d&&d.at?"на "+d.at:"";
if(!d){add(c,el("p","em",busy?"Загружаю…":"Нажмите на вкладку, чтобы загрузить"))}
else if(cur=="today"){
var k=add(c,el("div","k"));(d.k||[]).forEach(function(v){var b=add(k,el("div",v[2]?"w":""));add(b,el("b",null,String(v[1])));add(b,el("span",null,v[0]))});
var l=add(c,el("div","l"));(d.l||[]).forEach(function(s){add(l,el("p",null,s))})}
else if(cur=="orders"){
var l2=add(c,el("div","l"));
if(!(d.o||[]).length)add(l2,el("p","em","Активных заказов нет"));
(d.o||[]).forEach(function(o){var b=add(l2,el("div","o"));add(b,el("p",null,o[0]+" · "+o[2]));var s=add(b,el("p","s",o[3]+" · "+o[4]+" · "+o[1]));if(!o[5])add(s,el("span","np"," · не оплачен"))});
if(d.m)add(l2,el("p","em","и ещё "+d.m))}
else{
(d.r||[]).forEach(function(r){var row=add(c,el("div","r"));var a=add(row,el("div"));add(a,el("p",null,r[0]));add(a,el("b",null,r[1]));add(row,el("span",null,r[2]||""))});
if(d.th){var t=add(c,el("div","th"));add(t,el("p",null,"Порог 20 млн: "+d.th.a));var bar=add(t,el("div","bar"));var i=add(bar,el("i"));i.style.width=Math.min(100,d.th.p)+"%";add(t,el("p","s",d.th.f))}}
if(err||d&&d.err)add(c,el("p","er",err||d.err));
}
function load(){
if(!W||busy)return;busy=true;err="";draw();
W.request(cur).then(function(r){var d=JSON.parse(r.result);if(d.t&&(d.k||d.o||d.r))data[d.t]=d;else err=d.err||"Нет данных"},function(e){err=e&&e.code=="RATE_LIMITED"?"Слишком часто — подождите пару секунд":"Не удалось обновить, нажмите на вкладку ещё раз"}).then(function(){busy=false;draw()})}
if(W){W.onEvent("activated",load);W.onEvent("themeChanged",draw)}
draw();if(W){W.ready();load()}
</script>`;
