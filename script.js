const menuButton = document.querySelector(".menu-button");
const mobileMenu = document.querySelector(".mobile-menu");

if (menuButton && mobileMenu) {
  menuButton.addEventListener("click", () => {
    const isHidden = mobileMenu.hasAttribute("hidden");
    if (isHidden) {
      mobileMenu.removeAttribute("hidden");
      menuButton.setAttribute("aria-label", "메뉴 닫기");
    } else {
      mobileMenu.setAttribute("hidden", "");
      menuButton.setAttribute("aria-label", "메뉴 열기");
    }
  });
}

document.querySelectorAll('form[role="search"]').forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector('input[type="search"]');
    const keyword = input?.value.trim();
    if (keyword) {
      alert(`"${keyword}" 검색 기능은 콘텐츠 페이지 추가 후 연결됩니다.`);
    }
  });
});

const newsletterForm = document.querySelector(".newsletter form");
if (newsletterForm) {
  newsletterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = newsletterForm.querySelector('input[type="email"]').value.trim();
    if (email) {
      alert("구독 신청 예시가 완료되었습니다.");
      newsletterForm.reset();
    }
  });
}
