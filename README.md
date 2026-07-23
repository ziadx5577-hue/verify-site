# Night Store — Apple Pay + الراجحي + urpay

## مهم جدًا
هذا النظام لا يقدر يعرف تلقائيًا هل وصل تحويل الراجحي أو urpay، ولا يقدر يتأكد من الدفع في رابط Apple Pay الخارجي بدون API من منصة الدفع.
لذلك كل طلب يصل إلى Webhook ديسكورد ومعه زر **تأكيد استلام المبلغ**. بعد ضغط الزر:
- تتحول حالة الطلب إلى مدفوع.
- يزيد عداد المشتريات.
- يحصل العميل على رتبة العميل تلقائيًا.

## ترتيب الإعداد
1. ثبّت Node.js 18 أو أحدث.
2. غيّر اسم `.env.example` إلى `.env`.
3. عبّئ بيانات Discord وطرق الدفع داخل `.env`.
4. في Discord Developer Portal أضف هذا الرابط في OAuth2 Redirects:
   `http://localhost:3000/auth/discord/callback`
5. ادعُ البوت إلى السيرفر، واجعل رتبته أعلى من رتبة العميل.
6. افتح CMD داخل مجلد المشروع ونفّذ:
   ```bat
   npm install
   npm start
   ```
7. افتح:
   `http://localhost:3000`

## عند رفع الموقع على دومين
غيّر في `.env`:
```env
BASE_URL=https://your-domain.com
NODE_ENV=production
```
ثم أضف في Discord Developer Portal:
`https://your-domain.com/auth/discord/callback`

## مكان تعديل المنتجات
`data/products.json`

السعر بالهللات؛ مثال `1900` = `19.00 ريال`.

## مكان الطلبات
`data/orders.json`
