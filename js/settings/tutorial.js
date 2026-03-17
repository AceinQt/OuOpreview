const tutorialContentArea = document.getElementById('tutorial-content-area');

function setupTutorialApp() {
                tutorialContentArea.addEventListener('click', (e) => {
                    const header = e.target.closest('.tutorial-header');
                    if (header) {
                        header.parentElement.classList.toggle('open');
                    }
                });
            }



            

            function renderTutorialContent() {
                const tutorials = [
                    { title: '写在前面', imageUrls: ['https://i.postimg.cc/7PgyMG9S/image.jpg'] },
                    {
                        title: '软件介绍',
                        imageUrls: ['https://i.postimg.cc/VvsJRh6q/IMG-20250713-162647.jpg', 'https://i.postimg.cc/8P5FfxxD/IMG-20250713-162702.jpg', 'https://i.postimg.cc/3r94R3Sn/IMG-20250713-162712.jpg']
                    },
                    {
                        title: '404',
                        imageUrls: ['https://i.postimg.cc/x8scFPJW/IMG-20250713-162756.jpg', 'https://i.postimg.cc/pX6mfqtj/IMG-20250713-162809.jpg', 'https://i.postimg.cc/YScjV00q/IMG-20250713-162819.jpg', 'https://i.postimg.cc/13VfJw9j/IMG-20250713-162828.jpg']
                    },
                    { title: '404-群聊', imageUrls: ['https://i.postimg.cc/X7LSmRTJ/404.jpg'] }
                ];
                tutorialContentArea.innerHTML = '';
                renderUpdateLog();
                tutorials.forEach(tutorial => {
                    const item = document.createElement('div');
                    item.className = 'tutorial-item';
                    const imagesHtml = tutorial.imageUrls.map(url => `<img src="${url}" alt="${tutorial.title}教程图片">`).join('');
                    item.innerHTML = `<div class="tutorial-header">${tutorial.title}</div><div class="tutorial-content">${imagesHtml}</div>`;
                    tutorialContentArea.appendChild(item);
                });
                
            }