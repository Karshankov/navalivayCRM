import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import StaffCurrentActorBadge from "@/components/admin/staff/StaffCurrentActorBadge.vue";
import { useCrmStore } from "@/stores/crm";

describe("StaffCurrentActorBadge", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("явно показывает сотрудника, на которого запишется действие", () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      currentStaffShift: {
        id: "shift-1",
        version: 1,
        employee_id: "manager-1",
        employee_name: "Константин Жмурков",
        status: "active",
      },
    });

    const wrapper = mount(StaffCurrentActorBadge);

    expect(wrapper.text()).toContain("Текущая смена · Константин Жмурков");
    expect(wrapper.text()).toContain("Действие запишется на этого сотрудника");
  });

  it("предупреждает, если смена не открыта", () => {
    const store = useCrmStore();
    store.$patch({
      staffTrackingEnabled: true,
      currentStaffShift: null,
    });

    const wrapper = mount(StaffCurrentActorBadge);

    expect(wrapper.text()).toContain("Смена не открыта");
    expect(wrapper.text()).toContain("система предложит открыть смену");
  });
});
