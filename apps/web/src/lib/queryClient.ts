import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

export function getQueryClient() {
  return new QueryClient({
    // https://tanstack.com/query/v4/docs/reference/QueryCache#global-callbacks
    queryCache: new QueryCache({
      onError: (err) => handleError(err),
    }),
    // https://tanstack.com/query/v4/docs/reference/MutationCache#global-callbacks
    mutationCache: new MutationCache({
      onError: (err) => handleError(err),
    }),
  });
}

function handleError(err: unknown) {
  console.error(err);
  let message = "Something went wrong";
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "object") {
    if ("message" in (err as object)) {
      message = (err as { message: string }).message;
    }
  }
  toast.error(message);
}
