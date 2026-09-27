// RxDB core omits error text to save bundle size; dev-mode restores it.
// Must be the first rxdb-related import in the test run (setupFiles run first).
import 'rxdb/plugins/dev-mode'
