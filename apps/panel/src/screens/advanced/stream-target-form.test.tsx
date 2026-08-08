import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StreamTarget } from '@eduscope/shared';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { StreamTargetForm } from './stream-target-form.js';
import '../../styles/tokens.css';

const target: StreamTarget = {
  id: 'TARGET1', platform: 'youtube', displayName: 'Main YouTube', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2',
  hasStreamKey: true, requiresTlsBridge: false, enabled: true, lastPreflightAt: null, lastPreflightResult: 'ok',
};

function wrap(children: ReactNode) {
  return createElement(OverlayProvider, null, createElement('div', null, children));
}

describe('StreamTargetForm', () => {
  it('exposes exactly the three D-19 platform chips', () => {
    render(wrap(<StreamTargetForm target={null} phase="idle" problem={null} onSave={vi.fn()} onCancel={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'YouTube' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Facebook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom RTMP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Twitch' })).toBeNull();
  });

  it('a new target starts with an empty key and Save disabled until required fields are filled', () => {
    render(wrap(<StreamTargetForm target={null} phase="idle" problem={null} onSave={vi.fn()} onCancel={vi.fn()} />));
    expect(screen.getByLabelText(/Stream key/)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();
  });

  it('editing an existing target pre-fills name/URL, shows Configured, and leaves the key blank', () => {
    render(wrap(<StreamTargetForm target={target} phase="idle" problem={null} onSave={vi.fn()} onCancel={vi.fn()} />));
    expect(screen.getByDisplayValue('Main YouTube')).toBeInTheDocument();
    expect(screen.getByDisplayValue('rtmp://a.rtmp.youtube.com/live2')).toBeInTheDocument();
    expect(screen.getByText(/Stream key.*Configured/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stream key/)).toHaveValue('');
    expect(document.body.textContent).not.toMatch(/mock-stream-key|\*{4,}/);
  });

  it('editing without typing a replacement key omits streamKey from the save body', () => {
    const onSave = vi.fn();
    render(wrap(<StreamTargetForm target={target} phase="idle" problem={null} onSave={onSave} onCancel={vi.fn()} />));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })); });
    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ streamKey: expect.anything() }));
  });

  it('typing a replacement key includes it in the save body', () => {
    const onSave = vi.fn();
    render(wrap(<StreamTargetForm target={target} phase="idle" problem={null} onSave={onSave} onCancel={vi.fn()} />));
    fireEvent.change(screen.getByLabelText(/Stream key/), { target: { value: 'new-key' } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ streamKey: 'new-key' }));
  });

  it('a Paste failure reports inline and never clears the field', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    render(wrap(<StreamTargetForm target={null} phase="idle" problem={null} onSave={vi.fn()} onCancel={vi.fn()} />));
    fireEvent.change(screen.getByLabelText(/Stream key/), { target: { value: 'kept' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Paste/ })); });
    expect(await screen.findByText('Could not read the clipboard.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Stream key/)).toHaveValue('kept');
  });

  it('shows the named refusal message', () => {
    render(wrap(
      <StreamTargetForm
        target={null} phase="refused"
        problem={{ status: 422, code: 'validation.invalid', title: 'The streaming destination rejected these settings.' }}
        onSave={vi.fn()} onCancel={vi.fn()}
      />,
    ));
    expect(screen.getByText('The streaming destination rejected these settings.')).toBeInTheDocument();
  });
});
