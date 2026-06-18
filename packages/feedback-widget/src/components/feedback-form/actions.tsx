export function FeedbackFormActions({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 flex w-full justify-between gap-3">{children}</div>
  );
}

export function FeedbackFormActionsSecondary({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex gap-3">{children}</div>;
}
