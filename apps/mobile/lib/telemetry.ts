import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  beforeSend(event) {
    delete event.request;
    delete event.user;
    delete event.breadcrumbs;
    delete event.extra;
    for (const exception of event.exception?.values ?? [])
      exception.value = exception.type || "Application error";
    return event;
  },
});

export function reportPlaybackError(error: unknown) {
  Sentry.captureException(error);
}
