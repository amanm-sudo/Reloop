'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FOOD_CATEGORIES, MATERIAL_CATEGORIES, STORAGE_STATES } from '@/lib/domain';

/**
 * Two ways in: photograph it, or type it.
 *
 * The demo buttons exist because a live walkthrough cannot depend on a camera or on a model
 * responding. They resolve to committed fixtures and the resulting feed cards say "demo fixture",
 * so nothing is presented as a live extraction that is not one.
 */

const DEMO_IMAGES = [
  { key: 'receipt-gomti-nagar', label: 'Demo: kirana receipt' },
  { key: 'photo-leftover-sabzi', label: 'Demo: leftover sabzi' },
  { key: 'photo-fridge-produce', label: 'Demo: fridge shelf' },
] as const;

export function AddSurplus() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<'photo' | 'manual'>('photo');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function done(text: string) {
    setBusy(false);
    setMessage(text);
    startTransition(() => router.refresh());
  }

  async function submitPerception(body: FormData) {
    setBusy(true);
    setMessage(null);

    const response = await fetch('/api/perception', { method: 'POST', body });
    const payload = (await response.json()) as
      | { ok: true; data: { itemCount: number; needsConfirmation: number; startedRuns: string[] } }
      | { ok: false; error: { message: string } };

    if (!payload.ok) {
      done(payload.error.message);
      return;
    }

    const { itemCount, needsConfirmation, startedRuns } = payload.data;
    done(
      itemCount === 0
        ? 'Could not read that one — add the items by hand below.'
        : `Read ${itemCount} item${itemCount === 1 ? '' : 's'}${
            needsConfirmation > 0 ? `, ${needsConfirmation} to confirm` : ''
          }${startedRuns.length > 0 ? '. Agents are already working on the urgent one.' : '.'}`
    );
  }

  return (
    <section aria-labelledby="add-heading" className="border-line rounded-card border p-4">
      <h2 id="add-heading" className="text-sm font-semibold">
        Add surplus
      </h2>

      <div role="tablist" aria-label="How to add" className="mt-3 flex gap-1">
        {(['photo', 'manual'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-card px-3 py-1.5 text-xs font-medium ${
              mode === value ? 'bg-clay text-white' : 'bg-paper-sunken text-slate'
            }`}
          >
            {value === 'photo' ? 'Photo or receipt' : 'Type it in'}
          </button>
        ))}
      </div>

      {mode === 'photo' ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium" htmlFor="image">
            Photograph the food or the receipt
          </label>
          <input
            id="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const body = new FormData();
              body.set('image', file);
              void submitPerception(body);
            }}
            className="border-line rounded-card w-full border px-3 py-2 text-sm"
          />

          <div>
            <p className="text-slate text-xs">Or use a committed demo image:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEMO_IMAGES.map((demo) => (
                <button
                  key={demo.key}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const body = new FormData();
                    body.set('fixtureKey', demo.key);
                    void submitPerception(body);
                  }}
                  className="border-line rounded-card hover:bg-paper-sunken border px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
                >
                  {demo.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <ManualForm
          busy={busy}
          onSubmit={async (payload) => {
            setBusy(true);
            setMessage(null);
            const response = await fetch('/api/items', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const body = (await response.json()) as
              | { ok: true; data: { shouldActNow: boolean } }
              | { ok: false; error: { message: string } };
            done(
              body.ok
                ? body.data.shouldActNow
                  ? 'Added — that one is urgent, so the agents have started already.'
                  : 'Added to your pantry.'
                : body.error.message
            );
          }}
        />
      )}

      {message && (
        <p role="status" className="text-clay-ink mt-3 text-sm">
          {message}
        </p>
      )}
      {busy && (
        <p role="status" className="text-slate mt-2 text-sm">
          Working…
        </p>
      )}
    </section>
  );
}

type ManualPayload = {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  estimatedMassG?: number;
  storage: string;
  isCooked: boolean;
};

function ManualForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (payload: ManualPayload) => Promise<void>;
}) {
  const [unit, setUnit] = useState('g');
  const countBased = ['pcs', 'packs', 'servings'].includes(unit);

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          name: String(form.get('name') ?? ''),
          category: String(form.get('category') ?? ''),
          quantity: Number(form.get('quantity') ?? 0),
          unit: String(form.get('unit') ?? 'g'),
          estimatedMassG: countBased ? Number(form.get('estimatedMassG') ?? 0) : undefined,
          storage: String(form.get('storage') ?? 'FRIDGE'),
          isCooked: form.get('isCooked') === 'on',
        });
      }}
    >
      <Field label="What is it" name="name" />

      <div>
        <label htmlFor="category" className="block text-sm font-medium">
          Category
        </label>
        <select
          id="category"
          name="category"
          required
          className="border-line bg-paper-raised rounded-card mt-1 w-full border px-3 py-2.5 text-base"
        >
          <optgroup label="Food">
            {FOOD_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category.replace(/_/g, ' ')}
              </option>
            ))}
          </optgroup>
          <optgroup label="Materials (diversion tracked, footprint not quantified)">
            {MATERIAL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category.replace(/_/g, ' ')}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="How much" name="quantity" type="number" step="any" min="0" />
        <div>
          <label htmlFor="unit" className="block text-sm font-medium">
            Unit
          </label>
          <select
            id="unit"
            name="unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="border-line bg-paper-raised rounded-card mt-1 w-full border px-3 py-2.5 text-base"
          >
            {['g', 'kg', 'ml', 'l', 'pcs', 'packs', 'servings'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      {countBased && (
        <Field
          label="Roughly how many grams in total"
          name="estimatedMassG"
          type="number"
          step="any"
          min="0"
          hint="Everything downstream works in kilograms, so a count alone is not enough."
        />
      )}

      <div>
        <label htmlFor="storage" className="block text-sm font-medium">
          Where is it kept
        </label>
        <select
          id="storage"
          name="storage"
          className="border-line bg-paper-raised rounded-card mt-1 w-full border px-3 py-2.5 text-base"
        >
          {STORAGE_STATES.map((value) => (
            <option key={value} value={value}>
              {value.toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isCooked" className="accent-clay" />
        Already cooked
      </label>

      <button
        type="submit"
        disabled={busy}
        className="bg-clay rounded-card w-full px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        Add to pantry
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  hint,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        aria-describedby={hintId}
        className="border-line bg-paper-raised rounded-card mt-1 w-full border px-3 py-2.5 text-base"
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-slate mt-1 text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
