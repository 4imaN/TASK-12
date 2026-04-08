import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBadge from '../../components/StatusBadge.vue';

describe('StatusBadge', () => {
  it('renders with the correct class based on status prop', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'active' }
    });
    const span = wrapper.find('span');
    expect(span.classes()).toContain('badge');
    expect(span.classes()).toContain('badge-active');
  });

  it('displays the status text when no label is provided', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'draft' }
    });
    expect(wrapper.text()).toBe('draft');
  });

  it('displays the label instead of status when label is provided', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'published', label: 'Published' }
    });
    expect(wrapper.text()).toBe('Published');
    expect(wrapper.find('span').classes()).toContain('badge-published');
  });

  it('applies different classes for different statuses', () => {
    const statuses = ['draft', 'published', 'archived', 'pending'];
    for (const status of statuses) {
      const wrapper = mount(StatusBadge, { props: { status } });
      expect(wrapper.find('span').classes()).toContain(`badge-${status}`);
    }
  });
});
