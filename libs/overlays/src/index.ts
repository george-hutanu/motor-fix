// Small actions on top of the current screen.
//
// Open a task: `inject(Overlays).open(Task, { shape, title, data? })` resolves
// with the task's result, or 'cancelled'. The task reads its data and closes
// itself through `injectOverlayTask()`. On a phone (below 768 px when it
// opens) every shape is a bottom sheet with a grip that drags it closed; the
// task itself does not change.
//
// Save a task's form, the same way in every task:
//
//   readonly save = taskSave({
//     form: this.form,
//     send: (value, key) => this.api.save(value, key), // key → Idempotency-Key
//     done: (result) => this.task.close(result),       // or show <mf-task-done>
//     messages: 'public.signIn',                       // optional own texts
//   });
//
//   <form [formGroup]="form" (ngSubmit)="save.submit()">
//     <input hlmInput formControlName="email" aria-describedby="email-error" />
//     <mf-field-error id="email-error" [save]="save" [control]="form.controls.email" />
//     <mf-task-error [save]="save" />
//     <button type="submit" [mfTaskSubmit]="save">…</button>
//   </form>
//
// Fields use the kit's `hlmInput`, which marks an invalid field `aria-invalid`
// and paints its border once the press has touched it.
// Nothing is sent before the press. An invalid press shows each field's
// message and focuses the first. A failure keeps the text, shows the code's
// message next to the button and server field errors under their fields;
// the next press retries with the same key. Messages come from
// `<messages>.problem.<code>`, then `shell.form.problem.<code>`, and from
// `<messages>.field.<code>`, then `shell.form.field.<validator or code>`.
// `toProblem(error)` reads any failure as the API's problem shape.
export {
  type TaskSave,
  type TaskSaveOptions,
  type TaskSaveState,
  taskSave,
  toProblem,
} from './form/form';
export { FieldError, TaskDone, TaskError, TaskSubmit } from './form/form-parts';
export { Overlays } from './overlays';
export {
  injectOverlayTask,
  OVERLAY_TASK,
  type OverlayOptions,
  type OverlayResult,
  type OverlayShape,
  type OverlaySource,
  type OverlayTask,
} from './task';
