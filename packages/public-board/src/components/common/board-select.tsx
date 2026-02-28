import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";

interface Option {
  label: string;
  value: string;
}

interface BoardSelectProps {
  onSelectedBoardIdChange: (board: Option | null) => void;
  options: Option[];
  selectedBoardId: Option | null;
}

export function BoardSelect(props: BoardSelectProps) {
  return (
    <Select
      itemComponent={(props) => (
        <SelectItem item={props.item}>{props.item.rawValue.label}</SelectItem>
      )}
      onChange={(val) => props.onSelectedBoardIdChange(val)}
      options={props.options}
      optionTextValue="label"
      optionValue="value"
      value={props.selectedBoardId}
    >
      <SelectTrigger>
        <Select.Value<Option>>
          {(state) => state.selectedOption().label}
        </Select.Value>
      </SelectTrigger>
      <SelectContent />
    </Select>
  );
}
