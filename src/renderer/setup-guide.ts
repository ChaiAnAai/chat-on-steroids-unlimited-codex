/** Presentation only: completion is supplied by the existing connection evidence. */
export function paintSetupGuide(current: string | null, showAll: boolean): void {
  const wizard = document.getElementById('wizard')!;
  wizard.classList.toggle('is-guided', !showAll);
  const steps = [...wizard.querySelectorAll<HTMLElement>('.step')].filter(step => !step.hidden);
  for (const step of steps) {
    const heading = step.querySelector('h3')!;
    let button = heading.querySelector<HTMLButtonElement>('button');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'setup-step-toggle';
      button.append(...heading.childNodes); heading.append(button);
      const body = step.querySelector<HTMLElement>('.step-body')!;
      const content = document.createElement('div'); content.className = 'setup-step-content';
      content.id = `setup-content-${step.dataset.step}`;
      content.append(...[...body.children].filter(child => child !== heading)); body.append(content);
      button.setAttribute('aria-controls', content.id);
      button.addEventListener('click', () => {
        step.classList.toggle('is-reviewed');
        paintSetupGuide(wizard.dataset.current || null, wizard.dataset.showAll === 'true');
      });
    }
    // An input being edited must not disappear when a background state push advances setup.
    const editing = step.contains(document.activeElement) && document.activeElement !== button;
    const open = showAll || step.dataset.step === current || step.classList.contains('is-reviewed') || editing ||
      (step.dataset.step === 'chatgpt' && step.classList.contains('is-done') && !!step.querySelector('.has-unfinished'));
    step.classList.toggle('is-expanded', open);
    step.querySelector<HTMLElement>('.setup-step-content')!.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (step.dataset.step === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  }
  wizard.dataset.current = current ?? ''; wizard.dataset.showAll = String(showAll);
  const progress = document.getElementById('setupProgress')!;
  progress.textContent = `${steps.filter(step => step.classList.contains('is-done')).length} / ${steps.length}`;
}
