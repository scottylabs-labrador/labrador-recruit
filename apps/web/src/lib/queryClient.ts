import type { Query } from "@tanstack/react-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

/**
 * Options for a query whose *absence* is an ordinary state.
 *
 * Two endpoints answer 404 to mean "there is no recruitment cycle", which is
 * what is true between semesters. Left to the defaults, both of them produced
 * a healthy deployment that looked broken: react-query retried the 404 three
 * times with backoff, so the page sat on a skeleton for seconds, and the
 * global error toast then told the applicant "Something went wrong" over a
 * page that was already explaining, correctly, that applications are not open.
 *
 * Spread into the query that expects it. Every call site that uses this
 * already branches on `data === undefined` and renders its own explanation,
 * which is why suppressing the toast loses nothing. A 404 from anywhere else
 * still reports, because there it means a URL is wrong.
 */
export const absenceIsNormal = {
  retry: false,
  meta: { absenceIsNormal: true },
} as const;

export function getQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * One retry, not three.
         *
         * The default exists for flaky networks, and three attempts with
         * exponential backoff is a long time to show a skeleton for a request
         * that is simply going to fail. Mutations keep their default of none:
         * retrying a submit is the client's decision, not a transparent one.
         */
        retry: 1,
      },
    },
    // https://tanstack.com/query/v4/docs/reference/QueryCache#global-callbacks
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (query.meta?.["absenceIsNormal"] === true) {
          console.error(err);
          return;
        }
        handleError(err);
      },
    }),
    // https://tanstack.com/query/v4/docs/reference/MutationCache#global-callbacks
    mutationCache: new MutationCache({
      onError: (err) => handleError(err),
    }),
  });
}

export type { Query };

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
