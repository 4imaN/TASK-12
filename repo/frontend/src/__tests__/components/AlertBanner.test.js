import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AlertBanner from '../../components/AlertBanner.vue';

describe('AlertBanner', () => {
  it('renders the message text', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Something happened', show: true }
    });
    expect(wrapper.text()).toContain('Something happened');
  });

  it('applies the correct type class for success', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Saved', type: 'success', show: true }
    });
    expect(wrapper.find('.alert').classes()).toContain('alert-success');
  });

  it('applies the correct type class for danger', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Error', type: 'danger', show: true }
    });
    expect(wrapper.find('.alert').classes()).toContain('alert-danger');
  });

  it('applies the correct type class for warning', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Warning', type: 'warning', show: true }
    });
    expect(wrapper.find('.alert').classes()).toContain('alert-warning');
  });

  it('applies the correct type class for info (default)', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Info', show: true }
    });
    expect(wrapper.find('.alert').classes()).toContain('alert-info');
  });

  it('dismiss button emits dismiss event', async () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Dismissable', show: true, dismissible: true }
    });
    await wrapper.find('.modal-close').trigger('click');
    expect(wrapper.emitted('dismiss')).toBeTruthy();
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('is hidden when show is false', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Hidden', show: false }
    });
    expect(wrapper.find('.alert').exists()).toBe(false);
  });

  it('is visible when show is true', () => {
    const wrapper = mount(AlertBanner, {
      props: { message: 'Visible', show: true }
    });
    expect(wrapper.find('.alert').exists()).toBe(true);
  });
});
