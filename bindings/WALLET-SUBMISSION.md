# Native submission journal

`payment_call` exposes local operation inventory, reconciliation, endpoint observations,
and per-step exact-byte attempt reservations for all retained proposal steps. It performs no network I/O. The host
must serialize the complete reconcile/observe/begin/dispatch/finish interval for each
operation; local reconciliation may classify an interrupted `started` record as unknown.
A successful begin commits consent and attempt-start before returning bytes. A later
finish records acknowledgement, rejection, or uncertainty; acknowledgement is not inclusion.

Three extension tables retain a permanent database identity and recovery position,
per-step consent/strictest retry policy/observations, and every attempt. Consent binds
the native network, original plan and policy, operation, step, transaction ID and exact
byte digest, plus the host's qualified route digest. Missing route identity or consent
never permits automatic retry. Finalization alone grants no consent. Old databases
migrate with empty submission records. No explicit database-restore API is provided;
external copies preserving identity and counters cannot be detected by database-only recovery.

Automatic begin returns null for ordinary policy ineligibility. It requires a fresh
observation, previous durable attempt, current matching consent and route, remaining
strictest lifetime budget, persisted wall-clock spacing, and the host owner's monotonic
elapsed interval measured from the last attempt-start (or opening when prior timing is
untrusted). No session clock is persisted. Transaction expiry and inclusion are checked
against retained native chain identity; missing chain evidence requires explicit recovery.

Inventory captures a creation high-water mark and walks pages of at most 200 IDs.
Reads project all retained proposal steps and bounded attempt history, without loading
signers or proving assets. Material flags reuse native PCZT inspection and are structural,
not a claim of cryptographic authorization or available host assets. Native eligibility
checks retained dependencies before each step: acknowledgement alone does not establish
a parent, and automatic recovery never first-dispatches an unattempted child. The host
owns network observation and parent-first dispatch; the native journal owns eligibility,
consent, and exact-byte attempt records.

Finalization reuses native extraction/storage and immutable finalized records. The
already-finalized transparent-input limitation remains tracked by private SDK issue 102;
this journal does not change the underlying finalizer or claim that edge is qualified.
The synthetic SDK baseline passed actual Node filesystem and Firefox OPFS public
transfer, shielding, TEX, finalization, exact-byte retry, and reopen workflows
(SDK `b25ea5c`, runtime package 03/native build 03). This is scoped runtime
qualification, not complete SDK acceptance.
