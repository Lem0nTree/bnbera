import { LoadingState } from "@bnbera/ui";

export default function Loading() {
  return (
    <div className="page-shell page-shell--tight">
      <LoadingState label="Loading BNBEra marketplace" />
    </div>
  );
}
