import { ChevronDownIcon } from 'lucide-solid';
import { Button } from '../ui/button';

export function CommentsHeader({ totalComments }: { totalComments: number }) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-muted-foreground text-sm">
        {totalComments} {totalComments === 1 ? 'comment' : 'comments'}
      </div>
      <div>
        <Button variant="outline" size="sm" class="text-xs">
          Newest
          <ChevronDownIcon />
        </Button>
      </div>
    </div>
  );
}
