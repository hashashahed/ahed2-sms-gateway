/* Shared helpers + Arabic/English strings for every page. */
(function () {
  const AR = {
    'lang.switch': 'English',
    'nav.features': 'المميزات', 'nav.pricing': 'الأسعار', 'nav.docs': 'الـ API', 'nav.faq': 'أسئلة',
    'nav.login': 'دخول', 'nav.register': 'ابدأ مجاناً', 'nav.dashboard': 'لوحة التحكم',

    'hero.kicker': 'SMS API من شريحة جوالك',
    'hero.title': 'ابعت رسائل SMS من برنامجك أو موقعك، عن طريق جوالك',
    'hero.sub': 'نزّل التطبيق على أي جوال أندرويد، اربطه بحسابك بكود QR، وابعت رسائل من أي نظام بطلب API واحد. بدون مزود ولا تكلفة على كل رسالة.',
    'hero.cta': 'ابدأ مجاناً', 'hero.cta2': 'شوف الأسعار',
    'hero.note': 'باقة مجانية للتجربة، وما بدنا بطاقة.',
    'demo.app': 'تطبيقك', 'demo.cloud': 'السيرفر', 'demo.phone': 'جوالك', 'demo.to': 'الزبون',

    'how.title': 'كيف بيشتغل؟',
    'how.1.t': 'سجّل ونزّل التطبيق', 'how.1.d': 'اعمل حساب، ونزّل تطبيق أندرويد على جوال فيه شريحة.',
    'how.2.t': 'امسح كود الربط', 'how.2.d': 'من لوحة التحكم اضغط "ربط جهاز" وامسح الكود من التطبيق. الجوال بيصير متصل.',
    'how.3.t': 'ابعت من أي مكان', 'how.3.d': 'اعمل مفتاح API وابعت رسائل من موقعك أو برنامجك أو أي نظام بيحكي HTTP.',

    'feat.title': 'كل اللي بتحتاجه لرسائل الأعمال',
    'feat.1.t': 'API بسيط', 'feat.1.d': 'طلب واحد بيبعت لرقم أو لغاية 100 رقم مع بعض.',
    'feat.2.t': 'تتبّع الحالة', 'feat.2.d': 'بتعرف إذا الرسالة انبعتت ووصلت أو فشلت، ومع السبب.',
    'feat.3.t': 'الرسائل الواردة', 'feat.3.d': 'ردود زبائنك بتوصلك على اللوحة وعلى الـ webhook.',
    'feat.4.t': 'شريحتين', 'feat.4.d': 'اختار من أي شريحة بتطلع الرسالة بالجوالات ثنائية الشريحة.',
    'feat.5.t': 'Webhooks', 'feat.5.d': 'نظامك بيوصله إشعار لحظي لما تتغير حالة رسالة.',
    'feat.6.t': 'ما بتضيع رسالة', 'feat.6.d': 'إذا الجوال طفى أو انقطع النت، الرسائل بتستنى وبتنبعت أول ما يرجع.',

    'pricing.title': 'باقات بسيطة', 'pricing.sub': 'الرسائل بتطلع من شريحتك، فبتدفع بس اشتراك البرنامج.',
    'pricing.month': '/ شهر', 'pricing.free': 'مجاناً', 'pricing.msgs': '{n} رسالة بالشهر', 'pricing.unlimited': 'رسائل بلا حد',
    'pricing.devices1': 'جهاز واحد', 'pricing.devicesN': '{n} أجهزة', 'pricing.choose': 'اختار الباقة', 'pricing.popular': 'الأكثر طلباً',

    'code.title': 'ابعت أول رسالة بسطر واحد', 'code.sub': 'أي لغة برمجة بتقدر تبعت طلب HTTP بتنفع.',

    'faq.title': 'أسئلة شائعة',
    'faq.1.q': 'مين بيدفع ثمن الرسائل؟', 'faq.1.a': 'الرسائل بتطلع من شريحة جوالك، فبتنحسب من باقة شركة الاتصالات تبعك. إحنا بنبيعك البرنامج بس.',
    'faq.2.q': 'شو بيلزمني؟', 'faq.2.a': 'جوال أندرويد 8 أو أحدث فيه شريحة، ومتصل بالنت. الأفضل يكون جوال مخصص وعلى الشاحن.',
    'faq.3.q': 'في حد للإرسال؟', 'faq.3.a': 'كل باقة إلها حد شهري. ولحماية شريحتك من الحظر، التطبيق بيستنى ثانيتين بين كل رسالة. للحملات الدعائية الكبيرة استخدم مزود رسمي.',
    'faq.4.q': 'كيف بدفع؟', 'faq.4.a': 'من لوحة التحكم بتختار الباقة وبتشوف طريقة الدفع. بعد ما تحوّل، بنفعّلك الباقة.',

    'cta.title': 'جاهز تبعت أول رسالة؟', 'cta.btn': 'اعمل حساب مجاني',
    'footer.contact': 'تواصل معنا على واتساب', 'footer.rights': 'كل الحقوق محفوظة',

    'auth.login': 'تسجيل الدخول', 'auth.register': 'إنشاء حساب',
    'auth.loginSub': 'أهلاً فيك من جديد', 'auth.registerSub': 'ابدأ بالباقة المجانية، وبتقدر تطوّرها بأي وقت.',
    'f.name': 'الاسم', 'f.email': 'الإيميل', 'f.phone': 'رقم الجوال (للتواصل)', 'f.password': 'كلمة السر',
    'f.passwordHint': '8 أحرف على الأقل',
    'auth.noAccount': 'ما عندك حساب؟', 'auth.hasAccount': 'عندك حساب؟', 'auth.signupClosed': 'التسجيل مسكّر حالياً.',

    'tab.overview': 'نظرة عامة', 'tab.devices': 'الأجهزة', 'tab.keys': 'مفاتيح API', 'tab.messages': 'الرسائل',
    'tab.send': 'إرسال', 'tab.billing': 'الباقة والدفع', 'tab.docs': 'التوثيق', 'tab.settings': 'الإعدادات',
    'tab.admin': 'الإدارة', 'tab.a.overview': 'الإحصائيات', 'tab.a.users': 'المستخدمين', 'tab.a.requests': 'طلبات الدفع',
    'tab.a.plans': 'الباقات', 'tab.a.settings': 'إعدادات الموقع',
    'logout': 'خروج',

    'ov.hello': 'أهلاً {name}',
    'ov.usage': 'استهلاك هالشهر', 'ov.of': 'من {n}', 'ov.unlimited': 'بلا حد', 'ov.plan': 'باقتك', 'ov.expires': 'بتنتهي {d}',
    'ov.expired': 'باقتك المدفوعة انتهت، ورجعت على الباقة المجانية.', 'ov.never': 'ما بتنتهي',
    'ov.devices': 'الأجهزة المتصلة', 'ov.sent30': 'انبعتت (30 يوم)', 'ov.delivered30': 'وصلت (30 يوم)', 'ov.failed30': 'فشلت (30 يوم)',
    'ov.start': 'خطوات البداية', 'ov.s1': 'نزّل التطبيق على جوال أندرويد', 'ov.s2': 'اربط الجوال من صفحة الأجهزة',
    'ov.s3': 'اعمل مفتاح API', 'ov.s4': 'ابعت أول رسالة', 'ov.upgrade': 'طوّر باقتك', 'ov.pending': 'طلب ترقية باقتك قيد المراجعة.',
    'ov.quotaFull': 'خلصت رسائل هالشهر. طوّر باقتك عشان تكمّل إرسال.', 'ov.suspended': 'حسابك موقوف. تواصل معنا.',

    'dev.add': '+ ربط جهاز', 'dev.namePrompt': 'اسم الجهاز:', 'dev.defaultName': 'جوالي', 'dev.empty': 'ما في أجهزة لسا. اضغط "ربط جهاز".',
    'dev.online': 'متصل', 'dev.lastSeen': 'آخر ظهور {d}', 'dev.never': 'ما اتصل لسا', 'dev.relink': 'رابط جديد', 'dev.delete': 'حذف',
    'dev.confirmDelete': 'حذف الجهاز؟ رح ينفصل فوراً.', 'dev.confirmRelink': 'إنشاء رابط ربط جديد؟ الرابط القديم رح يبطل.',
    'dev.pairTitle': 'اربط الجوال', 'dev.pairHelp': 'افتح التطبيق على الجوال واضغط "مسح كود QR"، أو انسخ الرابط والصقه بالتطبيق. الكود بيظهر مرة وحدة بس.',
    'dev.copy': 'نسخ الرابط', 'dev.download': 'تنزيل تطبيق الأندرويد', 'dev.apkMissing': 'رابط التطبيق مش جاهز لسا، تواصل معنا.',
    'dev.limit': '{used} من {max} أجهزة', 'dev.sims': '{n} شريحة',

    'key.create': '+ مفتاح جديد', 'key.namePrompt': 'اسم المفتاح (مثلاً اسم موقعك):', 'key.empty': 'ما في مفاتيح. اعمل مفتاح عشان تستخدم الـ API.',
    'key.newTitle': 'مفتاحك الجديد', 'key.newHelp': 'انسخه واحفظه هلأ، ما رح يظهر مرة ثانية.', 'key.lastUsed': 'آخر استخدام: {d}',
    'key.never': 'ما استُخدم', 'key.confirmDelete': 'حذف المفتاح؟ أي نظام بيستخدمه رح يوقف.', 'copy': 'نسخ', 'copied': 'انسخ ✓',

    'msg.all': 'الكل', 'msg.out': 'الصادرة', 'msg.in': 'الواردة', 'msg.empty': 'ما في رسائل لسا.',
    'msg.phone': 'الرقم', 'msg.text': 'الرسالة', 'msg.status': 'الحالة', 'msg.time': 'الوقت', 'msg.more': 'عرض المزيد',
    'st.queued': 'بالانتظار', 'st.dispatched': 'عند الجهاز', 'st.accepted': 'الجهاز استلمها', 'st.sent': 'انبعتت',
    'st.delivered': 'وصلت', 'st.failed': 'فشلت', 'st.received': 'واردة',

    'send.to': 'الرقم', 'send.toHelp': 'أكثر من رقم؟ افصل بينهم بفاصلة أو سطر جديد.', 'send.device': 'الجهاز', 'send.auto': 'تلقائي (أول جهاز متصل)',
    'send.sim': 'الشريحة', 'send.simDefault': 'الافتراضية', 'send.sim1': 'شريحة 1', 'send.sim2': 'شريحة 2', 'send.body': 'نص الرسالة',
    'send.btn': 'إرسال', 'send.ok': 'تمام، {n} رسالة انضافت للإرسال.', 'send.offline': 'الجهاز مش متصل هلأ، الرسائل رح تنبعت أول ما يتصل.',
    'send.chars': '{n} حرف · {p} جزء',

    'bill.current': 'باقتك الحالية', 'bill.choose': 'طوّر باقتك', 'bill.months': 'المدة', 'bill.monthN': '{n} شهر',
    'bill.total': 'المجموع', 'bill.howToPay': 'طريقة الدفع', 'bill.reference': 'رقم العملية أو اسم المحوِّل',
    'bill.note': 'ملاحظة (اختياري)', 'bill.submit': 'أرسل طلب التفعيل', 'bill.sent': 'وصلنا طلبك، بنفعّل الباقة بعد ما نتأكد من الدفع.',
    'bill.history': 'طلباتك', 'bill.none': 'ما في طلبات.', 'bill.pending': 'قيد المراجعة', 'bill.approved': 'مفعّل', 'bill.rejected': 'مرفوض',
    'bill.current_badge': 'باقتك', 'bill.contact': 'استفسار؟ راسلنا على واتساب',

    'set.profile': 'الملف الشخصي', 'set.save': 'حفظ', 'set.saved': 'انحفظ ✓', 'set.webhook': 'رابط الـ Webhook',
    'set.webhookHelp': 'السيرفر بيبعت POST لهاد الرابط لما تتغير حالة رسالة أو توصلك رسالة. اتركه فاضي لتوقفه.',
    'set.password': 'تغيير كلمة السر', 'set.current': 'كلمة السر الحالية', 'set.new': 'كلمة السر الجديدة', 'set.change': 'تغيير',

    'docs.title': 'توثيق الـ API', 'docs.intro': 'كل الطلبات بتحتاج مفتاح API بالـ header اسمه x-api-key.',
    'docs.send': 'إرسال رسالة', 'docs.sendHelp': 'to رقم أو مصفوفة لغاية 100 رقم. اختياري: deviceId لاختيار جهاز، وsimSlot (0 أو 1) لاختيار الشريحة.',
    'docs.status': 'حالة رسالة', 'docs.statusHelp': 'الحالات: queued ← dispatched ← accepted ← sent ← delivered، أو failed مع سبب الخطأ في error.',
    'docs.list': 'قائمة الرسائل', 'docs.account': 'الباقة والاستهلاك', 'docs.webhook': 'Webhook',
    'docs.webhookHelp': 'إذا حطيت رابط بالإعدادات، بيوصلك هيك:', 'docs.errors': 'الأخطاء',
    'docs.errorsHelp': 'عند الخطأ بيرجع كود HTTP غير 200، ومعه error و message. أهمها: 401 مفتاح غلط، 402 خلصت الباقة، 429 طلبات كثير.',

    'a.users': 'المستخدمين', 'a.paid': 'مشتركين بباقات مدفوعة', 'a.devices': 'الأجهزة', 'a.msgMonth': 'رسائل هالشهر',
    'a.msg24': 'رسائل آخر 24 ساعة', 'a.pending': 'طلبات دفع بالانتظار', 'a.revenue': 'إيرادات هالشهر',
    'a.search': 'دوّر بالإيميل أو الاسم أو الرقم', 'a.user': 'المستخدم', 'a.plan': 'الباقة', 'a.usage': 'الاستهلاك',
    'a.joined': 'سجّل', 'a.actions': '', 'a.activate': 'تفعيل باقة', 'a.suspend': 'إيقاف', 'a.unsuspend': 'تفعيل الحساب',
    'a.resetPw': 'كلمة سر جديدة', 'a.makeAdmin': 'خليه أدمن', 'a.removeAdmin': 'شيل الأدمن', 'a.suspended': 'موقوف', 'a.admin': 'أدمن',
    'a.tempPw': 'كلمة السر المؤقتة لـ {email}:', 'a.confirmSuspend': 'إيقاف الحساب؟ أجهزته بتنفصل وما بيقدر يبعت.',
    'a.activateTitle': 'تفعيل باقة لـ {email}', 'a.months': 'عدد الأشهر', 'a.confirm': 'تأكيد', 'cancel': 'إلغاء',
    'a.req.all': 'الكل', 'a.req.pending': 'بالانتظار', 'a.approve': 'قبول وتفعيل', 'a.reject': 'رفض', 'a.rejectNote': 'سبب الرفض (بيشوفه الزبون):',
    'a.amount': 'المبلغ', 'a.ref': 'المرجع', 'a.noRequests': 'ما في طلبات.',
    'a.plan.new': '+ باقة جديدة', 'a.plan.edit': 'تعديل', 'a.plan.id': 'المعرّف (إنجليزي بدون مسافات)', 'a.plan.nameAr': 'الاسم بالعربي',
    'a.plan.nameEn': 'الاسم بالإنجليزي', 'a.plan.price': 'السعر الشهري', 'a.plan.currency': 'العملة', 'a.plan.limit': 'حد الرسائل الشهري (فاضي = بلا حد)',
    'a.plan.devices': 'عدد الأجهزة', 'a.plan.featAr': 'المميزات بالعربي (سطر لكل ميزة)', 'a.plan.featEn': 'المميزات بالإنجليزي',
    'a.plan.default': 'الباقة الافتراضية للمسجلين الجدد', 'a.plan.active': 'ظاهرة بالموقع', 'a.plan.sort': 'الترتيب', 'a.plan.hidden': 'مخفية',
    'a.plan.defaultBadge': 'افتراضية',
    'a.s.siteAr': 'اسم الموقع بالعربي', 'a.s.siteEn': 'اسم الموقع بالإنجليزي', 'a.s.payAr': 'تعليمات الدفع بالعربي',
    'a.s.payEn': 'تعليمات الدفع بالإنجليزي', 'a.s.whatsapp': 'رقم واتساب للتواصل (مع رمز الدولة)', 'a.s.signup': 'السماح بتسجيل حسابات جديدة',
    'a.apk': 'ملف تطبيق الأندرويد', 'a.apkHelp': 'ارفع ملف الـ APK هون، والزبائن بينزّلوه من لوحتهم.', 'a.apkUpload': 'رفع APK',
    'a.apkOk': 'انرفع التطبيق ✓', 'a.apkPresent': 'في نسخة مرفوعة.', 'a.apkNone': 'ما في تطبيق مرفوع لسا.',

    'err.network': 'ما في اتصال بالسيرفر', 'err.generic': 'صار خطأ، جرّب مرة ثانية',
    'err.bad_credentials': 'الإيميل أو كلمة السر غلط', 'err.email_taken': 'هاد الإيميل مسجّل من قبل', 'err.weak_password': 'كلمة السر لازم تكون 8 أحرف أو أكثر',
    'err.invalid_email': 'الإيميل مش صحيح', 'err.name_required': 'اكتب الاسم', 'err.signup_disabled': 'التسجيل مسكّر حالياً',
    'err.rate_limited': 'محاولات كثير، استنى شوي', 'err.quota_exceeded': 'خلصت رسائل باقتك هالشهر', 'err.device_limit': 'وصلت لحد الأجهزة بباقتك',
    'err.no_devices': 'لازم تربط جهاز أول', 'err.invalid_phone': 'في رقم مش صحيح', 'err.message_required': 'اكتب نص الرسالة',
    'err.to_required': 'اكتب رقم', 'err.request_pending': 'عندك طلب قيد المراجعة', 'err.invalid_webhook': 'رابط الـ webhook مش صالح',
    'err.bad_current_password': 'كلمة السر الحالية غلط', 'err.account_suspended': 'حسابك موقوف', 'err.self_action': 'ما بتقدر تعملها على حسابك',
    'err.invalid_apk': 'هاد مش ملف APK', 'err.message_too_long': 'الرسالة طويلة كثير',
  };

  const EN = {
    'lang.switch': 'العربية',
    'nav.features': 'Features', 'nav.pricing': 'Pricing', 'nav.docs': 'API', 'nav.faq': 'FAQ',
    'nav.login': 'Log in', 'nav.register': 'Start free', 'nav.dashboard': 'Dashboard',

    'hero.kicker': 'SMS API from your own SIM',
    'hero.title': 'Send SMS from your app or website, through your own phone',
    'hero.sub': 'Install the app on any Android phone, link it to your account with a QR code, and send messages from any system with one API call. No carrier contract, no per-message fees.',
    'hero.cta': 'Start free', 'hero.cta2': 'See pricing',
    'hero.note': 'Free plan for testing. No card required.',
    'demo.app': 'Your app', 'demo.cloud': 'Server', 'demo.phone': 'Your phone', 'demo.to': 'Customer',

    'how.title': 'How it works',
    'how.1.t': 'Sign up and install', 'how.1.d': 'Create an account and install the Android app on a phone with a SIM.',
    'how.2.t': 'Scan the pairing code', 'how.2.d': 'In the dashboard click "Link device" and scan the code from the app. The phone is now online.',
    'how.3.t': 'Send from anywhere', 'how.3.d': 'Create an API key and send messages from your website, software or anything that speaks HTTP.',

    'feat.title': 'Everything you need for business messaging',
    'feat.1.t': 'Simple API', 'feat.1.d': 'One request sends to one number or up to 100 at once.',
    'feat.2.t': 'Delivery tracking', 'feat.2.d': 'Know when a message is sent, delivered or failed, and why.',
    'feat.3.t': 'Incoming messages', 'feat.3.d': 'Customer replies show up in your dashboard and webhook.',
    'feat.4.t': 'Dual SIM', 'feat.4.d': 'Choose which SIM sends each message on dual-SIM phones.',
    'feat.5.t': 'Webhooks', 'feat.5.d': 'Get notified in real time when a message status changes.',
    'feat.6.t': 'Nothing gets lost', 'feat.6.d': 'If the phone goes offline, messages wait and send as soon as it is back.',

    'pricing.title': 'Simple plans', 'pricing.sub': 'Messages go out from your own SIM, so you only pay for the software.',
    'pricing.month': '/ month', 'pricing.free': 'Free', 'pricing.msgs': '{n} messages / month', 'pricing.unlimited': 'Unlimited messages',
    'pricing.devices1': '1 device', 'pricing.devicesN': '{n} devices', 'pricing.choose': 'Choose plan', 'pricing.popular': 'Most popular',

    'code.title': 'Send your first message in one line', 'code.sub': 'Works from any language that can make an HTTP request.',

    'faq.title': 'Questions',
    'faq.1.q': 'Who pays for the SMS?', 'faq.1.a': 'Messages are sent from your SIM, so they use your carrier bundle. We only charge for the software.',
    'faq.2.q': 'What do I need?', 'faq.2.a': 'An Android 8+ phone with a SIM and internet. A dedicated phone that stays on the charger works best.',
    'faq.3.q': 'Is there a sending limit?', 'faq.3.a': 'Each plan has a monthly limit. To protect your SIM from being blocked, the app waits two seconds between messages. For large marketing campaigns, use a licensed bulk provider.',
    'faq.4.q': 'How do I pay?', 'faq.4.a': 'Pick a plan in your dashboard to see payment details. We activate it once your transfer arrives.',

    'cta.title': 'Ready to send your first message?', 'cta.btn': 'Create a free account',
    'footer.contact': 'Contact us on WhatsApp', 'footer.rights': 'All rights reserved',

    'auth.login': 'Log in', 'auth.register': 'Create account',
    'auth.loginSub': 'Welcome back', 'auth.registerSub': 'Start on the free plan and upgrade any time.',
    'f.name': 'Name', 'f.email': 'Email', 'f.phone': 'Phone (for contact)', 'f.password': 'Password',
    'f.passwordHint': 'At least 8 characters',
    'auth.noAccount': "Don't have an account?", 'auth.hasAccount': 'Already have an account?', 'auth.signupClosed': 'Sign-ups are closed right now.',

    'tab.overview': 'Overview', 'tab.devices': 'Devices', 'tab.keys': 'API keys', 'tab.messages': 'Messages',
    'tab.send': 'Send', 'tab.billing': 'Plan & billing', 'tab.docs': 'Docs', 'tab.settings': 'Settings',
    'tab.admin': 'Admin', 'tab.a.overview': 'Stats', 'tab.a.users': 'Users', 'tab.a.requests': 'Payments',
    'tab.a.plans': 'Plans', 'tab.a.settings': 'Site settings',
    'logout': 'Log out',

    'ov.hello': 'Hi {name}',
    'ov.usage': 'Usage this month', 'ov.of': 'of {n}', 'ov.unlimited': 'unlimited', 'ov.plan': 'Your plan', 'ov.expires': 'Renews {d}',
    'ov.expired': 'Your paid plan expired and you are back on the free plan.', 'ov.never': 'No expiry',
    'ov.devices': 'Devices online', 'ov.sent30': 'Sent (30 days)', 'ov.delivered30': 'Delivered (30 days)', 'ov.failed30': 'Failed (30 days)',
    'ov.start': 'Getting started', 'ov.s1': 'Install the app on an Android phone', 'ov.s2': 'Link the phone from Devices',
    'ov.s3': 'Create an API key', 'ov.s4': 'Send your first message', 'ov.upgrade': 'Upgrade plan', 'ov.pending': 'Your upgrade request is being reviewed.',
    'ov.quotaFull': "You've used this month's messages. Upgrade to keep sending.", 'ov.suspended': 'Your account is suspended. Please contact us.',

    'dev.add': '+ Link device', 'dev.namePrompt': 'Device name:', 'dev.defaultName': 'My phone', 'dev.empty': 'No devices yet. Click "Link device".',
    'dev.online': 'Online', 'dev.lastSeen': 'Last seen {d}', 'dev.never': 'Never connected', 'dev.relink': 'New link', 'dev.delete': 'Delete',
    'dev.confirmDelete': 'Delete this device? It disconnects immediately.', 'dev.confirmRelink': 'Create a new pairing link? The old one stops working.',
    'dev.pairTitle': 'Link your phone', 'dev.pairHelp': 'Open the app on your phone and tap "Scan QR code", or copy the link and paste it in the app. This code is shown only once.',
    'dev.copy': 'Copy link', 'dev.download': 'Download the Android app', 'dev.apkMissing': 'The app download is not ready yet, please contact us.',
    'dev.limit': '{used} of {max} devices', 'dev.sims': '{n} SIM(s)',

    'key.create': '+ New key', 'key.namePrompt': 'Key name (e.g. your website):', 'key.empty': 'No keys yet. Create one to use the API.',
    'key.newTitle': 'Your new key', 'key.newHelp': "Copy it now, it won't be shown again.", 'key.lastUsed': 'Last used: {d}',
    'key.never': 'Never used', 'key.confirmDelete': 'Delete this key? Anything using it will stop working.', 'copy': 'Copy', 'copied': 'Copied ✓',

    'msg.all': 'All', 'msg.out': 'Outgoing', 'msg.in': 'Incoming', 'msg.empty': 'No messages yet.',
    'msg.phone': 'Number', 'msg.text': 'Message', 'msg.status': 'Status', 'msg.time': 'Time', 'msg.more': 'Load more',
    'st.queued': 'Queued', 'st.dispatched': 'At device', 'st.accepted': 'Accepted', 'st.sent': 'Sent',
    'st.delivered': 'Delivered', 'st.failed': 'Failed', 'st.received': 'Received',

    'send.to': 'Number', 'send.toHelp': 'Several numbers? Separate them with commas or new lines.', 'send.device': 'Device', 'send.auto': 'Automatic (first online device)',
    'send.sim': 'SIM', 'send.simDefault': 'Default', 'send.sim1': 'SIM 1', 'send.sim2': 'SIM 2', 'send.body': 'Message',
    'send.btn': 'Send', 'send.ok': 'Done, {n} message(s) queued.', 'send.offline': 'The device is offline; messages will send as soon as it connects.',
    'send.chars': '{n} chars · {p} part(s)',

    'bill.current': 'Current plan', 'bill.choose': 'Upgrade your plan', 'bill.months': 'Duration', 'bill.monthN': '{n} month(s)',
    'bill.total': 'Total', 'bill.howToPay': 'How to pay', 'bill.reference': 'Transaction reference or sender name',
    'bill.note': 'Note (optional)', 'bill.submit': 'Submit activation request', 'bill.sent': "Got it. We'll activate your plan once the payment is confirmed.",
    'bill.history': 'Your requests', 'bill.none': 'No requests.', 'bill.pending': 'Pending', 'bill.approved': 'Activated', 'bill.rejected': 'Rejected',
    'bill.current_badge': 'Current', 'bill.contact': 'Questions? Message us on WhatsApp',

    'set.profile': 'Profile', 'set.save': 'Save', 'set.saved': 'Saved ✓', 'set.webhook': 'Webhook URL',
    'set.webhookHelp': 'We POST to this URL when a message status changes or a message arrives. Leave empty to turn off.',
    'set.password': 'Change password', 'set.current': 'Current password', 'set.new': 'New password', 'set.change': 'Change',

    'docs.title': 'API documentation', 'docs.intro': 'Every request needs your API key in the x-api-key header.',
    'docs.send': 'Send a message', 'docs.sendHelp': '`to` is a number or an array of up to 100. Optional: deviceId to pick a device, simSlot (0 or 1) to pick the SIM.',
    'docs.status': 'Message status', 'docs.statusHelp': 'Statuses: queued → dispatched → accepted → sent → delivered, or failed with the reason in error.',
    'docs.list': 'List messages', 'docs.account': 'Plan and usage', 'docs.webhook': 'Webhook',
    'docs.webhookHelp': 'If you set a URL in Settings, you receive:', 'docs.errors': 'Errors',
    'docs.errorsHelp': 'Errors return a non-200 status with error and message. Most common: 401 bad key, 402 plan limit reached, 429 too many requests.',

    'a.users': 'Users', 'a.paid': 'On paid plans', 'a.devices': 'Devices', 'a.msgMonth': 'Messages this month',
    'a.msg24': 'Messages, last 24h', 'a.pending': 'Pending payments', 'a.revenue': 'Revenue this month',
    'a.search': 'Search by email, name or phone', 'a.user': 'User', 'a.plan': 'Plan', 'a.usage': 'Usage',
    'a.joined': 'Joined', 'a.actions': '', 'a.activate': 'Activate plan', 'a.suspend': 'Suspend', 'a.unsuspend': 'Reactivate',
    'a.resetPw': 'New password', 'a.makeAdmin': 'Make admin', 'a.removeAdmin': 'Remove admin', 'a.suspended': 'Suspended', 'a.admin': 'Admin',
    'a.tempPw': 'Temporary password for {email}:', 'a.confirmSuspend': "Suspend this account? Its devices disconnect and it can't send.",
    'a.activateTitle': 'Activate a plan for {email}', 'a.months': 'Months', 'a.confirm': 'Confirm', 'cancel': 'Cancel',
    'a.req.all': 'All', 'a.req.pending': 'Pending', 'a.approve': 'Approve & activate', 'a.reject': 'Reject', 'a.rejectNote': 'Reason (the customer sees it):',
    'a.amount': 'Amount', 'a.ref': 'Reference', 'a.noRequests': 'No requests.',
    'a.plan.new': '+ New plan', 'a.plan.edit': 'Edit', 'a.plan.id': 'ID (English, no spaces)', 'a.plan.nameAr': 'Arabic name',
    'a.plan.nameEn': 'English name', 'a.plan.price': 'Monthly price', 'a.plan.currency': 'Currency', 'a.plan.limit': 'Monthly message limit (empty = unlimited)',
    'a.plan.devices': 'Devices', 'a.plan.featAr': 'Features in Arabic (one per line)', 'a.plan.featEn': 'Features in English',
    'a.plan.default': 'Default plan for new sign-ups', 'a.plan.active': 'Shown on the site', 'a.plan.sort': 'Order', 'a.plan.hidden': 'Hidden',
    'a.plan.defaultBadge': 'Default',
    'a.s.siteAr': 'Site name (Arabic)', 'a.s.siteEn': 'Site name (English)', 'a.s.payAr': 'Payment instructions (Arabic)',
    'a.s.payEn': 'Payment instructions (English)', 'a.s.whatsapp': 'WhatsApp contact number (with country code)', 'a.s.signup': 'Allow new sign-ups',
    'a.apk': 'Android app file', 'a.apkHelp': 'Upload the APK here and customers download it from their dashboard.', 'a.apkUpload': 'Upload APK',
    'a.apkOk': 'App uploaded ✓', 'a.apkPresent': 'An app file is uploaded.', 'a.apkNone': 'No app uploaded yet.',

    'err.network': "Can't reach the server", 'err.generic': 'Something went wrong, try again',
    'err.bad_credentials': 'Wrong email or password', 'err.email_taken': 'This email is already registered', 'err.weak_password': 'Password must be at least 8 characters',
    'err.invalid_email': 'Invalid email', 'err.name_required': 'Enter your name', 'err.signup_disabled': 'Sign-ups are closed right now',
    'err.rate_limited': 'Too many attempts, wait a bit', 'err.quota_exceeded': "You've reached this month's message limit", 'err.device_limit': "You've reached your plan's device limit",
    'err.no_devices': 'Link a device first', 'err.invalid_phone': 'One of the numbers is invalid', 'err.message_required': 'Write a message',
    'err.to_required': 'Enter a number', 'err.request_pending': 'You already have a pending request', 'err.invalid_webhook': 'Invalid webhook URL',
    'err.bad_current_password': 'Current password is wrong', 'err.account_suspended': 'Your account is suspended', 'err.self_action': "You can't do that to your own account",
    'err.invalid_apk': 'That is not an APK file', 'err.message_too_long': 'The message is too long',
  };

  const DICT = { ar: AR, en: EN };
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch {}
  // Arabic by default; English only if the visitor chose it or their browser is in English.
  let lang = saved || (/^en\b/i.test(navigator.language || '') ? 'en' : 'ar');
  if (!DICT[lang]) lang = 'ar';

  function t(key, vars) {
    let s = (DICT[lang][key] ?? DICT.ar[key] ?? key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  function apply(root = document) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('lang', l); } catch {}
    apply();
    document.dispatchEvent(new CustomEvent('langchange'));
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, path, body, raw) {
    let r;
    try {
      r = await fetch(path, {
        method,
        headers: { 'x-app': '1', ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch { throw Object.assign(new Error(t('err.network')), { code: 'network' }); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const key = 'err.' + (data.error || 'generic');
      const msg = DICT[lang][key] ? t(key) : (data.message || t('err.generic'));
      throw Object.assign(new Error(msg), { code: data.error, status: r.status });
    }
    return data;
  }

  function toast(text) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast hidden'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 3800);
  }

  // Arabic text with Western digits (1, 2, 3), which is what most customers here read day to day.
  const locale = () => (lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB');
  const fmtDate = (ts, withTime = true) => ts
    ? new Date(ts).toLocaleString(locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
    : '—';
  const fmtNum = (n) => Number(n).toLocaleString('en-US');
  const SYMBOLS = { USD: '$', ILS: '₪', EUR: '€', JOD: 'JD ', GBP: '£' };
  const fmtMoney = (n, cur) => {
    const amount = Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const c = (cur || 'USD').toUpperCase();
    // Wrapped in LTR isolates so "$12" doesn't flip to "12$" inside Arabic text.
    return '⁦' + (SYMBOLS[c] ? `${SYMBOLS[c]}${amount}` : `${amount} ${c}`) + '⁩';
  };

  const LOGO = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="#fff"/><circle cx="8.5" cy="10.5" r="1.3" fill="#0f7a5a"/><circle cx="12" cy="10.5" r="1.3" fill="#0f7a5a"/><circle cx="15.5" cy="10.5" r="1.3" fill="#0f7a5a"/></svg>';

  window.SG = { t, apply, setLang, getLang: () => lang, esc, api, toast, fmtDate, fmtNum, fmtMoney, LOGO };
  if (document.readyState !== 'loading') apply(); else document.addEventListener('DOMContentLoaded', () => apply());
})();
