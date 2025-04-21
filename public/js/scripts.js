// Add/Remove Details
document.addEventListener('DOMContentLoaded', () => {
    const addDetailBtn = document.getElementById('add-detail');
    const detailsContainer = document.getElementById('details-container');

    if (addDetailBtn && detailsContainer) {
        let detailIndex = detailsContainer.children.length;

        // Add new detail entry
        addDetailBtn.addEventListener('click', () => {
            const div = document.createElement('div');
            div.className = 'flex gap-2 detail-entry animate-fade-in-up';
            div.style.animationDelay = '0.1s';
            div.innerHTML = `
                <input type="text" name="details[key][]" placeholder="Key" class="w-1/2 p-3 bg-white/70 backdrop-blur-md border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm hover:bg-indigo-50/30 transition-all duration-300">
                <input type="text" name="details[value][]" placeholder="Value" class="w-1/2 p-3 bg-white/70 backdrop-blur-md border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm hover:bg-indigo-50/30 transition-all duration-300">
                <button type="button" class="text-gray-400 hover:text-red-500 hover:scale-110 transition-all duration-300 ripple">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            `;
            detailsContainer.appendChild(div);
            detailIndex++;

            // Add remove functionality and ripple effect
            const removeBtn = div.querySelector('button');
            removeBtn.addEventListener('click', () => {
                div.remove();
                detailIndex--;
            });
            removeBtn.addEventListener('click', function (e) {
                const ripple = document.createElement('span');
                ripple.classList.add('absolute', 'rounded-full', 'bg-white/40', 'animate-ripple');
                const rect = this.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                ripple.style.width = ripple.style.height = `${size}px`;
                ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
                ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
                this.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            });
        });

        // Handle existing detail entries
        document.querySelectorAll('.detail-entry button').forEach(btn => {
            btn.classList.add('ripple');
            btn.addEventListener('click', () => {
                btn.parentElement.remove();
                detailIndex--;
            });
            btn.addEventListener('click', function (e) {
                const ripple = document.createElement('span');
                ripple.classList.add('absolute', 'rounded-full', 'bg-white/40', 'animate-ripple');
                const rect = this.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                ripple.style.width = ripple.style.height = `${size}px`;
                ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
                ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
                this.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            });
        });
    } else {
        console.error('Add Detail button or Details container not found');
    }
});