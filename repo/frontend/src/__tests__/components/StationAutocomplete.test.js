import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import StationAutocomplete from '../../components/StationAutocomplete.vue';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

describe('StationAutocomplete', () => {
  it('renders input with the default placeholder', () => {
    const wrapper = mount(StationAutocomplete, {
      props: { modelValue: '' }
    });
    const input = wrapper.find('input');
    expect(input.exists()).toBe(true);
    expect(input.attributes('placeholder')).toBe('Station name or code');
  });

  it('renders input with a custom placeholder', () => {
    const wrapper = mount(StationAutocomplete, {
      props: { modelValue: '', placeholder: 'Search stations' }
    });
    const input = wrapper.find('input');
    expect(input.attributes('placeholder')).toBe('Search stations');
  });

  it('emits update:modelValue on input', async () => {
    const wrapper = mount(StationAutocomplete, {
      props: { modelValue: '' }
    });
    const input = wrapper.find('input');
    // Simulate setting the input value and triggering the event
    await input.setValue('Penn');
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted[emitted.length - 1][0]).toBe('Penn');
  });

  it('displays the current modelValue in the input', () => {
    const wrapper = mount(StationAutocomplete, {
      props: { modelValue: 'Grand Central' }
    });
    const input = wrapper.find('input');
    expect(input.element.value).toBe('Grand Central');
  });
});
