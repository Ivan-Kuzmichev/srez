'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, type ControlTone } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { createTag } from '@/server/actions/accounts';

const NONE = 'none';
const NEW = '__new__';

export interface TagOption {
  id: string;
  name: string;
}

/** Tag picker whose last item creates a tag on the spot (docs/08-ui.md, section 5). */
export function TagSelect({
  id,
  name,
  tags: initial,
  defaultValue,
  tone,
}: {
  id?: string;
  name: string;
  tags: TagOption[];
  defaultValue?: string | null;
  tone?: ControlTone;
}) {
  const notify = useToast();
  const [tags, setTags] = useState(initial);
  const [value, setValue] = useState(defaultValue ?? NONE);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  async function save() {
    const result = await createTag(null, { name: draft });
    if (!result.ok) {
      notify({ tone: 'error', title: ru.security.failedToast });
      return;
    }
    setTags((list) => (list.some((t) => t.id === result.data.id) ? list : [...list, result.data]));
    setValue(result.data.id);
    setCreating(false);
    setDraft('');
  }

  const hidden = <input type="hidden" name={name} value={value === NONE ? '' : value} />;

  if (creating) {
    return (
      <div className="flex gap-2">
        {hidden}
        <Input
          id={id}
          tone={tone}
          autoFocus
          maxLength={40}
          placeholder={ru.tags.newPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) void save();
            }
            if (e.key === 'Escape') setCreating(false);
          }}
        />
        <Button variant="secondary-raised" disabled={!draft.trim()} onClick={() => void save()}>
          {ru.tags.add}
        </Button>
        <Button variant="text" className="px-2" onClick={() => setCreating(false)}>
          {ru.tags.cancel}
        </Button>
      </div>
    );
  }

  return (
    <>
      {hidden}
      <Select
        id={id}
        tone={tone}
        value={value}
        onValueChange={(next) => (next === NEW ? setCreating(true) : setValue(next))}
        options={[
          { value: NONE, label: ru.tags.none },
          ...tags.map((t) => ({ value: t.id, label: t.name })),
          { value: NEW, label: ru.tags.create },
        ]}
      />
    </>
  );
}
