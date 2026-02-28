import { MessageSquare } from 'lucide-solid';

export function CommentsEmptyState() {
  return (
    <div class="flex flex-col items-center justify-center gap-4 text-center">
      <div class=" flex justify-center">
        <div class="relative">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <MessageSquare class="h-6 w-6 text-muted-foreground" />
          </div>
        </div>
      </div>
      <h3 class="font-medium text-lg">No comments</h3>
    </div>
  );
}
