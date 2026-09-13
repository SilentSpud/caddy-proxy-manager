/**
 * Exit so the supervisor starts the process again. Its own module so a test can replace it rather
 * than end the test runner.
 */

/**
 * Long enough for the response to reach the browser, short enough that the operator is not left
 * watching a modal that has not started doing anything.
 */
const EXIT_DELAY_MS = 750;

export function scheduleProcessRestart(reason: string): void {
  // Scheduled rather than immediate: an exit inside the handler closes the socket before the reply
  // is written, and a browser cannot tell that apart from the app having crashed.
  setTimeout(() => {
    console.log(reason);
    process.exit(0);
  }, EXIT_DELAY_MS);
}
