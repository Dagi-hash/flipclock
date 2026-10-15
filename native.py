import re, os, glob
from PIL import Image, ImageDraw
R = 'android/app/src/main/res/'

# ---- black splash + launcher background ----
for f in glob.glob(R + '**/splash.png', recursive=True): os.remove(f)
open(R + 'drawable/splash.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#000000"/></shape>\n')
open(R + 'values/ic_launcher_background.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')

# ---- theme: black status & navigation bars ----
p = R + 'values/styles.xml'; s = open(p).read()
s = s.replace('<item name="android:background">@null</item>', '<item name="android:background">@null</item>\n        <item name="android:statusBarColor">#000000</item>\n        <item name="android:navigationBarColor">#000000</item>\n        <item name="android:windowBackground">#000000</item>')
open(p, 'w').write(s)

# ---- manifest permissions ----
p = 'android/app/src/main/AndroidManifest.xml'; s = open(p).read()
s = s.replace('<uses-permission android:name="android.permission.INTERNET" />', '''<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />''')
open(p, 'w').write(s)

# ---- launcher icons from the PWA icon ----
src = Image.open('www/icons/icon-512.png').convert('RGB')
fg = Image.open('www/icons/maskable-512.png').convert('RGB')
for d, legacy, adaptive in [('mdpi',48,108),('hdpi',72,162),('xhdpi',96,216),('xxhdpi',144,324),('xxxhdpi',192,432)]:
    a = src.resize((legacy, legacy), Image.LANCZOS)
    a.save(f'{R}mipmap-{d}/ic_launcher.png')
    m = Image.new('L', (legacy, legacy), 0); ImageDraw.Draw(m).ellipse([0,0,legacy-1,legacy-1], fill=255)
    r = a.copy(); r.putalpha(m); r.save(f'{R}mipmap-{d}/ic_launcher_round.png')
    fg.resize((adaptive, adaptive), Image.LANCZOS).save(f'{R}mipmap-{d}/ic_launcher_foreground.png')

# ---- web code: native behaviours ----
js = open('www/app.js').read()
def rep(a, b):
    global js
    assert a in js, a[:40]; js = js.replace(a, b)
rep("if ('serviceWorker' in navigator) {", "if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {")
rep("const show = !isInstalledApp() && !installedFlag;", "const show = !isInstalledApp() && !installedFlag && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());")
rep("    } catch (e) {}\n}\nfunction loadState()", "    } catch (e) {}\n    if (typeof scheduleNativeSync === 'function') scheduleNativeSync();\n}\nfunction loadState()")
js += r'''

/* ================= NATIVE ANDROID: ALARMS & TIMER THAT RING IN THE BACKGROUND ================= */
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const LN = isNativeApp ? window.Capacitor.Plugins.LocalNotifications : null;
let nativeReady = false;
let nativeSyncTimer = null;

function scheduleNativeSync() {
    if (!LN) return;
    clearTimeout(nativeSyncTimer);
    nativeSyncTimer = setTimeout(nativeSync, 300);
}

async function nativeSync() {
    try {
        if (!nativeReady) {
            let perm = await LN.checkPermissions();
            if (perm.display !== 'granted') perm = await LN.requestPermissions();
            if (perm.display !== 'granted') return;
            await LN.createChannel({ id: 'alarms', name: 'Alarms & Timer', description: 'Alarm and timer alerts', importance: 5, visibility: 1, vibration: true });
            nativeReady = true;
        }
        const pending = await LN.getPending();
        if (pending.notifications.length) {
            await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
        }
        const list = [];
        alarms.filter(a => a.enabled).forEach(a => list.push({
            id: (a.id % 2000000000) + 10,
            title: a.label || 'Alarm',
            body: formatAlarmTimeDisplay(a.hour, a.minute),
            channelId: 'alarms',
            schedule: { on: { hour: a.hour, minute: a.minute }, allowWhileIdle: true }
        }));
        if (timerRunning && timerEndAt > Date.now()) {
            list.push({ id: 1, title: 'Timer Complete', body: 'Your countdown has finished', channelId: 'alarms',
                        schedule: { at: new Date(timerEndAt), allowWhileIdle: true } });
        }
        if (list.length) await LN.schedule({ notifications: list });
    } catch (e) { console.error('native sync failed', e); }
}
'''
open('www/app.js', 'w').write(js)

