import FilterChip from '../FilterChip';

export default function FilterChipExample() {
  return (
    <div className="flex gap-2 p-6">
      <FilterChip label="Country" value="France" onRemove={() => console.log('Remove filter')} />
      <FilterChip label="Campaign" value="Summer 2024" onRemove={() => console.log('Remove filter')} />
      <FilterChip label="ACOS" value=">20%" />
    </div>
  );
}
