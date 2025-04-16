document.addEventListener('DOMContentLoaded', () => {
    const addDetailBtn = document.getElementById('add-detail');
    const detailsContainer = document.getElementById('details');

    if (addDetailBtn && detailsContainer) {
        let detailIndex = detailsContainer.children.length;

        addDetailBtn.addEventListener('click', () => {
            const div = document.createElement('div');
            div.className = 'flex gap-2';
            div.innerHTML = `
                <input type="text" name="details[${detailIndex}][key]" placeholder="Key" class="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                <input type="text" name="details[${detailIndex}][value]" placeholder="Value" class="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            `;
            detailsContainer.appendChild(div);
            detailIndex++;
        });
    }
});