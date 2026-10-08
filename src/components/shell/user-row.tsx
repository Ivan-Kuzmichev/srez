import { signOut } from '@/server/actions/auth';
import { ru } from '@/lib/i18n/ru';

/** Login name and «Выйти», under the sync status in the sidebar and on «Ещё». */
export function UserRow({ username }: { username: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border-subtle pt-1 text-caption">
      <a
        href="/settings/security"
        className="flex min-h-11 items-center text-text no-underline hover:text-text"
      >
        {username}
      </a>
      <form
        action={async (form: FormData) => {
          'use server';
          await signOut(null, form);
        }}
      >
        <button
          type="submit"
          className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-caption text-accent-text hover:text-accent-text-hover"
        >
          {ru.nav.logout}
        </button>
      </form>
    </div>
  );
}
