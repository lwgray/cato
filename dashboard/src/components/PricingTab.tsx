/**
 * Tab 4 — Pricing.
 *
 * Two panels:
 * 1. Current-prices table (the latest ``effective_from`` row per
 *    model+provider). Powers the cost calculations everywhere else.
 * 2. "Add new rate" form that POSTs to ``/api/cost/prices``. Marcus's
 *    versioning means inserting a new ``effective_from`` overrides the
 *    seed price for future events without rewriting history.
 *
 * Per #409's pricing model, prices are versioned by ``effective_from``
 * and the latest row wins. Edits are append-only.
 */

import { useEffect, useState } from 'react';
import {
  createPrice,
  fetchCurrentPrices,
  type ModelPriceRow,
  type PriceCreatePayload,
} from '../services/costService';
import './PricingTab.css';

function formatPrice(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const EMPTY_FORM: PriceCreatePayload = {
  model: '',
  provider: 'anthropic',
  input_per_million: 0,
  output_per_million: 0,
  cache_creation_per_million: null,
  cache_read_per_million: null,
  source: 'cato_user',
};

const PricingTab = () => {
  const [prices, setPrices] = useState<ModelPriceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<PriceCreatePayload>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const load = async () => {
    try {
      const { prices } = await fetchCurrentPrices();
      setPrices(prices);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.model.trim() || !form.provider.trim()) {
      setFormError('Model and provider are required.');
      return;
    }
    if (form.input_per_million < 0 || form.output_per_million < 0) {
      setFormError('Prices must be non-negative.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createPrice(form);
      setFormSuccess(
        `Inserted ${form.model} (${form.provider}) effective ` +
          `${formatDate(result.effective_from)}`,
      );
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cost-pricing">
      <section className="cost-panel">
        <h3>Current prices</h3>
        {error && <div className="cost-error inline">⚠ {error}</div>}
        {prices.length === 0 ? (
          <p className="empty">No prices loaded yet — Marcus's seed should populate on first server start.</p>
        ) : (
          <table className="cost-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Effective from</th>
                <th>Input / M</th>
                <th>Cache create / M</th>
                <th>Cache read / M</th>
                <th>Output / M</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={`${p.model}-${p.provider}-${p.effective_from}`}>
                  <td className="model-cell">{p.model}</td>
                  <td>{p.provider}</td>
                  <td>{formatDate(p.effective_from)}</td>
                  <td className="price-cell">{formatPrice(p.input_per_million)}</td>
                  <td className="price-cell">
                    {formatPrice(p.cache_creation_per_million)}
                  </td>
                  <td className="price-cell">
                    {formatPrice(p.cache_read_per_million)}
                  </td>
                  <td className="price-cell">{formatPrice(p.output_per_million)}</td>
                  <td>
                    <span className={`source-tag source-${p.source ?? 'default'}`}>
                      {p.source ?? 'default'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cost-panel">
        <h3>Add new rate</h3>
        <p className="hint">
          Inserts a versioned row. Old experiments keep their original cost;
          new events use this rate going forward.
        </p>

        <form className="price-form" onSubmit={handleSubmit}>
          <label>
            <span>Model</span>
            <input
              type="text"
              required
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="claude-sonnet-4-6"
            />
          </label>
          <label>
            <span>Provider</span>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="cloud">cloud</option>
              <option value="local">local</option>
            </select>
          </label>
          <label>
            <span>Input $/M</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              required
              value={form.input_per_million}
              onChange={(e) =>
                setForm({ ...form, input_per_million: Number(e.target.value) })
              }
            />
          </label>
          <label>
            <span>Output $/M</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              required
              value={form.output_per_million}
              onChange={(e) =>
                setForm({ ...form, output_per_million: Number(e.target.value) })
              }
            />
          </label>
          <label>
            <span>Cache create $/M</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form.cache_creation_per_million ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  cache_creation_per_million:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
              placeholder="(none)"
            />
          </label>
          <label>
            <span>Cache read $/M</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form.cache_read_per_million ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  cache_read_per_million:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
              placeholder="(none)"
            />
          </label>
          <label>
            <span>Source</span>
            <select
              value={form.source ?? 'cato_user'}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="cato_user">cato_user</option>
              <option value="contract">contract</option>
            </select>
          </label>
          <label>
            <span>Effective from</span>
            <input
              type="datetime-local"
              value={form.effective_from?.slice(0, 16) ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  effective_from: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : undefined,
                })
              }
            />
          </label>

          <div className="form-footer">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add rate'}
            </button>
            {formError && <span className="form-msg form-error">{formError}</span>}
            {formSuccess && (
              <span className="form-msg form-success">{formSuccess}</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
};

export default PricingTab;
