//
// Creates a sign-in account and prints its temporary password once.
//
// The API has an admin endpoint for this, but it needs an administrator to call
// it, so the first account has to come from somewhere. Run it against the
// deployment's database:
//
//   bun run apps/server/scripts/createAccount.ts <andrewId> "<Full Name>" [--admin]
//
import { accountService } from "../src/services/accountService.ts";

const args = process.argv.slice(2);
const andrewId = args.find((arg) => !arg.startsWith("--"));
const name = args.filter((arg) => !arg.startsWith("--"))[1];

if (andrewId === undefined || name === undefined) {
  throw new Error('Usage: createAccount.ts <andrewId> "<Full Name>" [--admin]');
}

const created = await accountService.createAccount({
  andrewId,
  name,
  role: args.includes("--admin") ? "admin" : "user",
});

console.log(`
Account created.

  Andrew ID  ${created.andrewId}
  Name       ${created.name}
  Role       ${created.role}
  Password   ${created.temporaryPassword}

The password is temporary: they will be made to choose their own before the
application will show them anything. It is not recoverable - reissue instead.
`);

process.exit(0);
