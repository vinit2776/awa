"use client";

import { useEffect, useState } from "react";
import { subscribeToPush, unsubscribeFromPush } from "./pushActions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export function PushNotifications() {
  const [status, setStatus] = useState<"unsupported" | "unsubscribed" | "subscribed" | "checking">(() =>
    isSupported() ? "checking" : "unsupported",
  );

  useEffect(() => {
    if (status !== "checking") return;
    // Registration itself happens once, globally, in ServiceWorkerRegister
    // (root layout) — this just waits for it and checks current state.
    navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setStatus(existing ? "subscribed" : "unsubscribed");
    });
  }, [status]);

  const enable = async () => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
    await subscribeToPush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    setStatus("subscribed");
  };

  const disable = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await unsubscribeFromPush(subscription.endpoint);
      await subscription.unsubscribe();
    }
    setStatus("unsubscribed");
  };

  if (status === "unsupported" || status === "checking") return null;

  return (
    <button
      type="button"
      onClick={status === "subscribed" ? disable : enable}
      className={cn(buttonVariants({ variant: "outline" }))}
    >
      {status === "subscribed" ? "Disable notifications" : "Enable notifications"}
    </button>
  );
}
