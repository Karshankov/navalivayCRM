import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import GroupReviewsModal from "@/components/reviews/GroupReviewsModal.vue";

const fetchGroupReviewsMock = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useCustomerOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useCustomerOrders")>();
  return {
    ...actual,
    useCustomerOrders: () => ({
      fetchGroupReviews: fetchGroupReviewsMock,
    }),
  };
});

describe("GroupReviewsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and renders public reviews when opened", async () => {
    fetchGroupReviewsMock.mockResolvedValue({
      group_id: "grp1",
      review_count: 1,
      average_rating: 5,
      manager: {
        display_name: "Manager Rezonsky",
        avatar_url: "/favicon.png",
      },
      items: [
        {
          id: "rev1",
          rating: 5,
          body_text: "Отличный вкус, рекомендую",
          purchased_variant_name: "Ананасовая шипучка",
          quick_tag_labels: ["Вкусно"],
          created_at: "2026-06-01T10:00:00.000Z",
          manager_reply: "Спасибо!",
          reviewer: {
            display_name: "Аноним",
            photo_url: null,
            is_anonymous: true,
          },
        },
      ],
    });

    const wrapper = mount(GroupReviewsModal, {
      props: {
        open: true,
        groupId: "grp1",
        groupName: "Подонки",
      },
      global: {
        stubs: {
          CustomerModalShell: {
            props: ["open", "title"],
            template: '<div class="modal-shell"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();

    expect(fetchGroupReviewsMock).toHaveBeenCalledWith("grp1", expect.any(Object));
    expect(wrapper.text()).toContain("Отличный вкус, рекомендую");
    expect(wrapper.text()).toContain("Ананасовая шипучка");
    expect(wrapper.text()).toContain("Спасибо!");
    expect(wrapper.text()).toContain("Manager Rezonsky");

    wrapper.unmount();
  });

  it("shows empty state when no published reviews", async () => {
    fetchGroupReviewsMock.mockResolvedValue({
      group_id: "grp1",
      review_count: 0,
      average_rating: null,
      items: [],
    });

    const wrapper = mount(GroupReviewsModal, {
      props: { open: true, groupId: "grp1" },
      global: {
        stubs: {
          CustomerModalShell: {
            template: '<div class="modal-shell"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Пока нет опубликованных отзывов");

    wrapper.unmount();
  });

  it("renders XSS payload as plain text without executing scripts", async () => {
    fetchGroupReviewsMock.mockResolvedValue({
      group_id: "grp1",
      review_count: 1,
      average_rating: 5,
      items: [
        {
          id: "rev-xss",
          rating: 5,
          body_text: '<script>alert("xss")</script> Безопасный отзыв',
          purchased_variant_name: null,
          quick_tag_labels: [],
          created_at: "2026-06-01T10:00:00.000Z",
          manager_reply: null,
          reviewer: {
            display_name: "Покупатель",
            photo_url: null,
            is_anonymous: false,
          },
        },
      ],
    });

    const wrapper = mount(GroupReviewsModal, {
      props: { open: true, groupId: "grp1" },
      global: {
        stubs: {
          CustomerModalShell: {
            template: '<div class="modal-shell"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Безопасный отзыв");
    expect(wrapper.find("script").exists()).toBe(false);

    wrapper.unmount();
  });
});