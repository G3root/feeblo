import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

type PostBoardSelectProps = {
  boards: { id: string; name: string }[];
  currentBoardId: string;
  onValueChange: (boardId: string | null) => void;
};

export function PostBoardSelect({
  boards,
  currentBoardId,
  onValueChange,
}: PostBoardSelectProps) {
  const currentBoard = boards.find((b) => b.id === currentBoardId);

  return (
    <Select onValueChange={onValueChange} value={currentBoardId}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select board">
          {currentBoard?.name ?? "Select board"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {boards.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

