# Deferred — 159-form-saving

- The story's end-to-end flow "sign up with an e-mail that is taken; the error shows next to the button and the typed name stays" waits for the sign-up form (the create-an-account story, https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56); this story's e2e drives the catalogue's sample form. Add that flow to the sign-up story's e2e on `taskSave()`. (author, story Tests)
- The kit's `hlmInput` marks a field `aria-invalid="true"` as soon as its control is invalid, before any press (Spartan `BrnInput` binds it to `control.invalid`), so an empty required field is announced invalid on open. Make the kit input follow the shared reveal rule (an error-state matcher, or `aria-invalid` from `taskSave`). (author, a11y)
