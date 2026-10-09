import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PosCustomerPanel from "@/components/admin/PosCustomerPanel.vue";

const searchCustomersForPosMock = vi.fn();
const createPosCustomerMock = vi.fn();
const fetchPosCustomerHistoryMock = vi.fn();

vi.mock("@/stores/crm", () => ({
  useCrmStore: () => ({
    searchCustomersForPos: searchCustomersForPosMock,
    createPosCustomer: createPosCustomerMock,
    fetchPosCustomerHistory: fetchPosCustomerHistoryMock,
    deletePosCustomer: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PosCustomerPanel escape handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchCustomersForPosMock.mockReset();
    createPosCustomerMock.mockReset();
    fetchPosCustomerHistoryMock.mockReset();

    searchCustomersForPosMock.mockResolvedValue([]);
    fetchPosCustomerHistoryMock.mockResolvedValue([]);
  });

  it("closes the create modal when Escape is pressed", async () => {
    const wrapper = mount(PosCustomerPanel, {
      props: {
        modelValue: null,
      },
    });
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text().includes("Добавить клиента"))!.trigger("click");
    expect(wrapper.text()).toContain("Новый клиент кассы");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();

    expect(wrapper.text()).not.toContain("Новый клиент кассы");
  });

  it("does not close the create modal during an in-flight save", async () => {
    const pending = deferred<{ customer: Record<string, unknown>; merged: boolean }>();
    createPosCustomerMock.mockReturnValue(pending.promise);

    const wrapper = mount(PosCustomerPanel, {
      props: {
        modelValue: null,
      },
    });
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text().includes("Добавить клиента"))!.trigger("click");
    await wrapper.find('input[type="text"]').setValue("Иван");
    await wrapper.find('input[type="tel"]').setValue("+375291112233");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();

    expect(wrapper.text()).toContain("Новый клиент кассы");

    pending.resolve({
      customer: {
        id: "customer-1",
        first_name: "Иван",
        last_name: "",
        phone: "+375291112233",
      },
      merged: false,
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("Новый клиент кассы");
  });
});
