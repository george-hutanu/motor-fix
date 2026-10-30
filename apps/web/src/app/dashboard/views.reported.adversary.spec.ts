import { DASHBOARDS } from './views';

// @traces 1389-FR-001
describe('the reported reviews view of the admin dashboard', () => {
  const reviews = () =>
    DASHBOARDS.admin.views.find((v) => v.path === 'reviews');

  it('is released, so it shows in the menu, the bar and the routes', () => {
    expect(reviews()).toBeDefined();
    expect(reviews()?.unreleased).toBeUndefined();
  });

  it('carries the pending reports as its counter, under the admin reviews capability', () => {
    expect(reviews()?.counter).toBe('reportsPending');
    expect(reviews()?.capability).toBe('admin.reviews');
  });

  it('loads its body lazily and resolves to the reviews component', async () => {
    const body = await reviews()?.load?.();

    expect(body).toBeDefined();
    expect((body as { name: string }).name).toBe('AdminReviews');
  });

  it('appears once only in the admin views', () => {
    expect(
      DASHBOARDS.admin.views.filter((v) => v.path === 'reviews').length,
    ).toBe(1);
  });

  it('keeps no other admin view on the pending-reports counter', () => {
    expect(
      DASHBOARDS.admin.views.filter((v) => v.counter === 'reportsPending')
        .length,
    ).toBe(1);
  });
});
