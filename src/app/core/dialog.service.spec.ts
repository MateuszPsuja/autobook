import { TestBed } from '@angular/core/testing';
import { DialogService, DialogState } from './dialog.service';

function opts(s: DialogState): { title: string; variant?: string } {
  if (s.kind === 'none') throw new Error('no dialog');
  return s.opts;
}

describe('DialogService', () => {
  let service: DialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DialogService] });
    service = TestBed.inject(DialogService);
  });

  it('starts with no dialog visible', () => {
    expect(service.state().kind).toBe('none');
  });

  it('confirm() shows a confirm dialog and resolves true on confirm', async () => {
    const promise = service.confirm({
      title: 'Delete?',
      message: 'Are you sure?'
    });
    expect(service.state().kind).toBe('confirm');
    expect(opts(service.state()).title).toBe('Delete?');

    service.dismiss(true);
    await expectAsync(promise).toBeResolvedTo(true);
    expect(service.state().kind).toBe('none');
  });

  it('confirm() resolves false on cancel', async () => {
    const promise = service.confirm({
      title: 'Delete?',
      message: 'Are you sure?'
    });
    service.dismiss(false);
    await expectAsync(promise).toBeResolvedTo(false);
  });

  it('alert() shows an alert dialog and resolves on dismiss', async () => {
    const promise = service.alert({
      title: 'Heads up',
      message: 'Something happened.',
      variant: 'warning'
    });
    expect(service.state().kind).toBe('alert');
    expect(opts(service.state()).variant).toBe('warning');

    service.dismiss(false);
    await expectAsync(promise).toBeResolved();
  });

  it('queues a second dialog when one is already open and opens it after the first dismisses', async () => {
    const first = service.confirm({ title: 'First', message: 'one' });
    const second = service.confirm({ title: 'Second', message: 'two' });
    expect(service.state().kind).toBe('confirm');
    expect(opts(service.state()).title).toBe('First');

    service.dismiss(true);
    await expectAsync(first).toBeResolvedTo(true);
    await Promise.resolve();
    expect(service.state().kind).toBe('confirm');
    expect(opts(service.state()).title).toBe('Second');

    service.dismiss(true);
    await expectAsync(second).toBeResolvedTo(true);
  });
});
