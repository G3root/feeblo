export const RESEND_COOLDOWN_SECONDS = 60;

export function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getResendLabel({
  cooldown,
  isResending,
}: {
  cooldown: number;
  isResending: boolean;
}) {
  if (isResending) {
    return "Sending…";
  }
  if (cooldown > 0) {
    return `Resend in ${formatCountdown(cooldown)}`;
  }
  return "Resend code";
}
