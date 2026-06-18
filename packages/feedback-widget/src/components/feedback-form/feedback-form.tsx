export function FeedbackFormFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex h-full flex-col p-6">{children}</div>;
}
